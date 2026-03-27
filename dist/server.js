#!/usr/bin/env node
/**
 * wechat-claude-code MCP Server
 *
 * 功能清单:
 *   - 微信消息 ↔ Claude Code 双向桥接
 *   - 权限审批（白名单规则 + y/n 确认）
 *   - 任务完成推送通知
 *   - 流式进度推送（30s 心跳）
 *   - 中断控制（/stop）
 *   - 多项目管理（/project add/list/switch）
 *   - 审批白名单（/allow /deny /whitelist）
 *   - 任务历史（/history /retry /redo）
 *   - 定时任务（/schedule /cron /jobs /cancel）
 *   - 用量统计（/usage）
 *   - 用户访问控制（/trust /untrust /users）
 *   - 文件请求（/get）
 */
import './proxy.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fs from 'node:fs';
import { getActiveAccount, saveAccount, loadSyncBuf, saveSyncBuf, saveLastUser } from './store.js';
import { getUpdates, sendMessage, sendTyping, getConfig } from './ilink-api.js';
import { loginBrowser } from './auth.js';
import { uploadMedia, downloadMedia } from './cdn.js';
import { stripMarkdown, chunkText } from './text-utils.js';
import { MessageItemType } from './types.js';
import { watchApprovals, respondToLatest, respondToApproval, pendingApprovals, formatApprovalRequest, } from './approval.js';
import { checkRule, addRule, removeRule, formatRules } from './whitelist.js';
import { addHistory, updateSummary, getEntry, formatHistory } from './history.js';
import { addJob, removeJob, getDueJobs, markJobRun, formatJobs, parseScheduleCommand, } from './scheduler.js';
import { isUserTrusted, addTrustedUser, removeTrustedUser, formatUsers } from './users.js';
import { trackMessage, formatUsage } from './usage.js';
import { addProject, removeProject, findProject, getActiveProject, setActiveProject, formatProjects, } from './projects.js';
// ─── 状态 ─────────────────────────────────────────────
let pollingActive = false;
let pollingAbort = null;
const typingTicketCache = new Map();
let lastUserId = '';
let lastContextToken = '';
// 进度推送定时器（userId → timer）
const progressTimers = new Map();
// 当前任务 history id（userId → historyId）
const activeHistoryId = new Map();
// ─── 常量 ─────────────────────────────────────────────
const SESSION_EXPIRED_ERRCODE = -14;
const MAX_SESSION_RETRIES = 3;
const MAX_CONSECUTIVE_FAILURES = 5;
const INITIAL_RETRY_DELAY_MS = 2_000;
const MAX_RETRY_DELAY_MS = 30_000;
const SESSION_PAUSE_MS = 5 * 60_000;
const PROGRESS_INTERVAL_MS = 30_000;
// ─── 辅助函数 ─────────────────────────────────────────
function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
    });
}
async function pushToUser(text, userId, contextToken) {
    const account = getActiveAccount();
    if (!account)
        return;
    const uid = userId ?? lastUserId;
    const token = contextToken ?? lastContextToken;
    if (!uid || !token)
        return;
    const chunks = chunkText(stripMarkdown(text), 3900);
    for (const chunk of chunks) {
        await sendMessage(account.token, uid, chunk, token, account.baseUrl);
    }
}
function startProgressTimer(userId, contextToken) {
    stopProgressTimer(userId);
    let elapsed = 0;
    const timer = setInterval(async () => {
        elapsed += PROGRESS_INTERVAL_MS / 1000;
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        const timeStr = mins > 0 ? `${mins}分${secs > 0 ? secs + '秒' : ''}` : `${secs}秒`;
        await pushToUser(`⏳ Claude 处理中... (已 ${timeStr})`, userId, contextToken).catch(() => { });
    }, PROGRESS_INTERVAL_MS);
    progressTimers.set(userId, timer);
}
function stopProgressTimer(userId) {
    const t = progressTimers.get(userId);
    if (t) {
        clearInterval(t);
        progressTimers.delete(userId);
    }
}
async function extractText(msg) {
    const parts = [];
    for (const item of msg.item_list ?? []) {
        const t = item.type ?? 0;
        if (t === MessageItemType.TEXT) {
            if (item.text_item?.text) {
                if (item.ref_msg) {
                    const refContent = item.ref_msg.title || item.ref_msg.message_item?.text_item?.text || '';
                    if (refContent)
                        parts.push(`[引用: ${refContent}]`);
                }
                parts.push(item.text_item.text);
            }
        }
        else if (t === MessageItemType.IMAGE) {
            let desc = '[图片]';
            if (item.image_item?.media?.encrypt_query_param && item.image_item?.media?.aes_key) {
                try {
                    const fp = await downloadMedia({ encryptQueryParam: item.image_item.media.encrypt_query_param, aesKeyBase64: item.image_item.media.aes_key });
                    desc += `\n[附件: ${fp}]`;
                }
                catch { /* ignore */ }
            }
            parts.push(desc);
        }
        else if (t === MessageItemType.VOICE) {
            parts.push(`[语音] ${item.voice_item?.text ?? ''}`);
        }
        else if (t === MessageItemType.FILE) {
            let desc = `[文件: ${item.file_item?.file_name ?? 'unknown'}]`;
            if (item.file_item?.media?.encrypt_query_param && item.file_item?.media?.aes_key) {
                try {
                    const fp = await downloadMedia({ encryptQueryParam: item.file_item.media.encrypt_query_param, aesKeyBase64: item.file_item.media.aes_key, fileName: item.file_item.file_name });
                    desc += `\n[附件: ${fp}]`;
                }
                catch { /* ignore */ }
            }
            parts.push(desc);
        }
        else if (t === MessageItemType.VIDEO) {
            parts.push('[视频]');
        }
    }
    return parts.join('\n') || '[空消息]';
}
// ─── 命令处理 ─────────────────────────────────────────
async function handleCommand(text, userId, contextToken) {
    const t = text.trim();
    // ── 审批响应 y/n ──
    const approveM = /^([yYnN])(?:\s+([a-f0-9]{8,16}))?$/.exec(t);
    if (approveM) {
        const isAllow = approveM[1].toLowerCase() === 'y';
        const decision = isAllow ? 'allow' : 'deny';
        const partialId = approveM[2];
        let handled;
        if (partialId) {
            const fullId = [...pendingApprovals.keys()].find(id => id.startsWith(partialId));
            handled = fullId ? respondToApproval(fullId, decision) : false;
        }
        else {
            handled = respondToLatest(decision) !== null;
        }
        if (handled)
            await pushToUser(isAllow ? '✅ 已允许' : '❌ 已拒绝', userId, contextToken);
        else
            await pushToUser('暂无待审批操作', userId, contextToken);
        return true;
    }
    // ── 白名单审批规则 ──
    const allowM = /^\/allow\s+(\S+)(?::(.+))?$/.exec(t);
    if (allowM) {
        const rule = addRule('allow', allowM[1], allowM[2]);
        await pushToUser(`✅ 已添加允许规则 #${rule.id}\n${allowM[1]}${allowM[2] ? ':' + allowM[2] : ''}`, userId, contextToken);
        return true;
    }
    const denyM = /^\/deny\s+(\S+)(?::(.+))?$/.exec(t);
    if (denyM) {
        const rule = addRule('deny', denyM[1], denyM[2]);
        await pushToUser(`❌ 已添加拒绝规则 #${rule.id}\n${denyM[1]}${denyM[2] ? ':' + denyM[2] : ''}`, userId, contextToken);
        return true;
    }
    if (t === '/whitelist' || t === '/rules') {
        await pushToUser(`📋 审批白名单\n\n${formatRules()}\n\n/allow <工具>:<模式>  添加允许\n/deny <工具>:<模式>   添加拒绝\n/whitelist remove <id>  删除`, userId, contextToken);
        return true;
    }
    const wlRemM = /^\/whitelist\s+remove\s+(\d+)$/.exec(t);
    if (wlRemM) {
        const ok = removeRule(parseInt(wlRemM[1]));
        await pushToUser(ok ? '✅ 规则已删除' : '规则不存在', userId, contextToken);
        return true;
    }
    // ── 项目管理 ──
    if (t === '/projects' || t === '/project list') {
        const active = getActiveProject();
        await pushToUser(`📂 项目列表${active ? `（当前: ${active}）` : ''}\n\n${formatProjects()}`, userId, contextToken);
        return true;
    }
    const projectAddM = /^\/project\s+add\s+(\S+)\s+(.+)$/.exec(t);
    if (projectAddM) {
        const [, name, dir] = projectAddM;
        const ok = addProject(name, dir.trim());
        await pushToUser(ok ? `✅ 已添加项目 ${name}\n路径: ${dir.trim()}` : `项目 ${name} 已存在`, userId, contextToken);
        return true;
    }
    const projectRemM = /^\/project\s+remove\s+(\S+)$/.exec(t);
    if (projectRemM) {
        const ok = removeProject(projectRemM[1]);
        await pushToUser(ok ? `✅ 已删除项目 ${projectRemM[1]}` : '项目不存在', userId, contextToken);
        return true;
    }
    const switchM = /^\/switch\s+(\S+)$/.exec(t);
    if (switchM) {
        const name = switchM[1];
        const project = findProject(name);
        if (!project) {
            await pushToUser(`项目 "${name}" 不存在\n使用 /project add ${name} <路径> 先添加`, userId, contextToken);
            return true;
        }
        setActiveProject(name);
        await pushToUser(`🔄 已切换到项目: ${name}\n路径: ${project.dir}`, userId, contextToken);
        // 通知 Claude 切换目录
        server.notification({
            method: 'notifications/claude/channel',
            params: {
                content: `[系统指令] 请立即切换工作目录到 ${project.dir}，后续所有操作在此目录下进行。`,
                meta: { source: 'wechat-channel', user_id: userId, context_token: contextToken, message_id: '', session_id: '' },
            },
        });
        return true;
    }
    // ── 中断 ──
    if (t === '/stop' || t === '停止') {
        stopProgressTimer(userId);
        try {
            process.kill(process.ppid, 'SIGINT');
            await pushToUser('⏹ 已发送中断信号', userId, contextToken);
        }
        catch (err) {
            await pushToUser(`中断失败: ${String(err)}`, userId, contextToken);
        }
        return true;
    }
    // ── 任务历史 ──
    if (t === '/history') {
        await pushToUser(`📜 任务历史\n\n${formatHistory()}\n\n/retry 重发最新  /redo <n> 重发第n条`, userId, contextToken);
        return true;
    }
    if (t === '/retry') {
        const entry = getEntry(1);
        if (!entry) {
            await pushToUser('暂无历史', userId, contextToken);
            return true;
        }
        await pushToUser(`🔄 重发: ${entry.message.slice(0, 50)}`, userId, contextToken);
        return false; // 让消息走正常流程，但内容改为 entry.message
    }
    const redoM = /^\/redo\s+(\d+)$/.exec(t);
    if (redoM) {
        const entry = getEntry(parseInt(redoM[1]));
        if (!entry) {
            await pushToUser('历史记录不存在', userId, contextToken);
            return true;
        }
        await pushToUser(`🔄 重发第 ${redoM[1]} 条: ${entry.message.slice(0, 50)}`, userId, contextToken);
        // 把历史消息转发给 Claude
        server.notification({
            method: 'notifications/claude/channel',
            params: {
                content: entry.message,
                meta: { source: 'wechat-channel', user_id: userId, context_token: contextToken, message_id: '', session_id: '' },
            },
        });
        return true;
    }
    // ── 定时任务 ──
    const scheduleResult = parseScheduleCommand(t);
    if (scheduleResult) {
        const job = addJob({ ...scheduleResult, userId, contextToken });
        const icon = scheduleResult.type === 'once' ? '⏰' : '🔄';
        await pushToUser(`${icon} 定时任务已创建 [${job.id}]\n${scheduleResult.schedule}\n→ ${scheduleResult.task.slice(0, 60)}`, userId, contextToken);
        return true;
    }
    if (t === '/jobs') {
        await pushToUser(`⏰ 定时任务\n\n${formatJobs()}\n\n/cancel <id> 取消任务`, userId, contextToken);
        return true;
    }
    const cancelM = /^\/cancel\s+(\S+)$/.exec(t);
    if (cancelM) {
        const ok = removeJob(cancelM[1]);
        await pushToUser(ok ? `✅ 任务 ${cancelM[1]} 已取消` : '任务不存在', userId, contextToken);
        return true;
    }
    // ── 用量统计 ──
    if (t === '/usage') {
        await pushToUser(formatUsage(), userId, contextToken);
        return true;
    }
    // ── 用户管理 ──
    if (t === '/users') {
        await pushToUser(`👥 信任用户\n\n${formatUsers()}\n\n/trust <微信ID> 添加\n/untrust <微信ID> 移除`, userId, contextToken);
        return true;
    }
    const trustM = /^\/trust\s+(\S+)(?:\s+(.+))?$/.exec(t);
    if (trustM) {
        const ok = addTrustedUser(trustM[1], trustM[2]);
        await pushToUser(ok ? `✅ 已添加信任用户` : '用户已在列表中', userId, contextToken);
        return true;
    }
    const untrustM = /^\/untrust\s+(\S+)$/.exec(t);
    if (untrustM) {
        const ok = removeTrustedUser(untrustM[1]);
        await pushToUser(ok ? '✅ 已移除' : '用户不在列表中', userId, contextToken);
        return true;
    }
    // ── 文件请求 ──
    const getM = /^\/get\s+(.+)$/.exec(t);
    if (getM) {
        const filePath = getM[1].trim().replace(/^~/, process.env.HOME ?? '');
        const account = getActiveAccount();
        if (!account) {
            await pushToUser('未登录', userId, contextToken);
            return true;
        }
        try {
            if (!fs.existsSync(filePath)) {
                await pushToUser(`文件不存在: ${filePath}`, userId, contextToken);
                return true;
            }
            const stat = fs.statSync(filePath);
            if (stat.size > 10 * 1024 * 1024) {
                await pushToUser('文件超过 10MB，无法发送', userId, contextToken);
                return true;
            }
            // 文本文件直接发内容
            const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
            const textExts = ['ts', 'js', 'py', 'md', 'txt', 'json', 'yaml', 'yml', 'toml', 'sh', 'env', 'html', 'css', 'rs', 'go'];
            if (textExts.includes(ext) && stat.size < 4000) {
                const content = fs.readFileSync(filePath, 'utf-8');
                await pushToUser(`📄 ${filePath}\n\n${content}`, userId, contextToken);
            }
            else {
                await uploadMedia({ token: account.token, toUser: userId, contextToken, filePath, baseUrl: account.baseUrl });
                await pushToUser(`📎 已发送文件: ${filePath.split('/').pop()}`, userId, contextToken);
            }
        }
        catch (err) {
            await pushToUser(`发送失败: ${String(err)}`, userId, contextToken);
        }
        return true;
    }
    // ── 状态 ──
    if (t === '/status' || t === '/状态') {
        const pending = pendingApprovals.size;
        const active = getActiveProject();
        const lines = [
            `📊 状态`,
            `轮询: ${pollingActive ? '✅ 运行中' : '❌ 已停止'}`,
            `当前项目: ${active ?? '未设置'}`,
            `待审批: ${pending} 个`,
        ];
        if (pending > 0) {
            for (const [id, req] of pendingApprovals)
                lines.push(`  · ${req.tool_name} (${id.slice(0, 8)})`);
        }
        await pushToUser(lines.join('\n'), userId, contextToken);
        return true;
    }
    // ── 帮助 ──
    if (t === '/help' || t === '/帮助') {
        await pushToUser([
            '📖 命令列表',
            '',
            '审批',
            '  y / n           允许/拒绝最新操作',
            '  y <id> / n <id> 允许/拒绝指定操作',
            '',
            '审批白名单',
            '  /allow Bash:npm* 自动允许某类命令',
            '  /deny Bash:rm*   自动拒绝某类命令',
            '  /whitelist        查看规则',
            '',
            '项目',
            '  /project add <名> <路径>  添加项目',
            '  /projects                 列出项目',
            '  /switch <名>              切换项目',
            '',
            '任务控制',
            '  /stop     中断当前任务',
            '  /history  查看历史',
            '  /retry    重发最新任务',
            '  /redo <n> 重发第n条历史',
            '',
            '定时任务',
            '  /schedule 09:00 "任务"',
            '  /cron "0 9 * * 1" "任务"',
            '  /jobs     查看任务',
            '  /cancel <id> 取消任务',
            '',
            '其他',
            '  /usage    用量统计',
            '  /get <路径> 请求文件',
            '  /trust <ID> 添加信任用户',
            '  /users    用户列表',
            '  /status   运行状态',
        ].join('\n'), userId, contextToken);
        return true;
    }
    return false;
}
// ─── MCP Server ───────────────────────────────────────
const server = new Server({ name: 'wechat-channel', version: '1.0.0' }, {
    capabilities: { experimental: { 'claude/channel': {} }, tools: {} },
    instructions: `Messages arrive as <channel source="wechat-channel" user_id="..." context_token="..." message_id="...">.
Reply using the reply tool. Pass user_id and context_token from the channel tag.
For media: set media to an absolute local file path to send image/video/file.
For quote reply: set reply_to_message_id to the message_id from the channel tag.
When you complete a task, call the notify tool with a brief summary.
IMPORTANT: Always use the reply tool to respond to WeChat messages. Do not just output text.`,
});
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: 'login',
            description: '扫码登录微信',
            inputSchema: { type: 'object', properties: {} },
        },
        {
            name: 'reply',
            description: '回复微信消息',
            inputSchema: {
                type: 'object',
                properties: {
                    user_id: { type: 'string', description: '微信用户 ID' },
                    context_token: { type: 'string', description: '会话上下文令牌' },
                    content: { type: 'string', description: '回复文本内容' },
                    media: { type: 'string', description: '可选：本地文件绝对路径' },
                    reply_to_message_id: { type: 'string', description: '可选：引用回复的消息 ID' },
                },
                required: ['user_id', 'context_token', 'content'],
            },
        },
        {
            name: 'notify',
            description: '主动向用户推送通知（无需用户先发消息）',
            inputSchema: {
                type: 'object',
                properties: { content: { type: 'string', description: '通知内容' } },
                required: ['content'],
            },
        },
    ],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (name === 'login') {
        try {
            const result = await loginBrowser();
            saveAccount({ token: result.token, baseUrl: result.baseUrl ?? '', botId: result.accountId, savedAt: new Date().toISOString() });
            startPolling();
            return { content: [{ type: 'text', text: `登录成功！账号: ${result.accountId}` }] };
        }
        catch (err) {
            return { content: [{ type: 'text', text: `登录失败: ${String(err)}` }], isError: true };
        }
    }
    if (name === 'reply') {
        const userId = args?.user_id;
        const contextToken = args?.context_token;
        const content = args?.content;
        const media = args?.media;
        const replyToMessageId = args?.reply_to_message_id;
        if (!userId || !contextToken || !content) {
            return { content: [{ type: 'text', text: '缺少必填参数' }], isError: true };
        }
        const account = getActiveAccount();
        if (!account)
            return { content: [{ type: 'text', text: '未登录' }], isError: true };
        if (media && !fs.existsSync(media))
            return { content: [{ type: 'text', text: `文件不存在: ${media}` }], isError: true };
        try {
            // 停止进度推送
            stopProgressTimer(userId);
            // 更新历史摘要
            const histId = activeHistoryId.get(userId);
            if (histId) {
                updateSummary(histId, content);
                activeHistoryId.delete(userId);
            }
            // 统计用量
            trackMessage('received', content);
            await sendTypingIfPossible(account, userId, contextToken, 1);
            const plainText = stripMarkdown(content);
            const chunks = chunkText(plainText, 3900);
            for (let i = 0; i < chunks.length; i++) {
                await sendMessage(account.token, userId, chunks[i], contextToken, account.baseUrl, i === 0 ? replyToMessageId : undefined);
            }
            if (media) {
                try {
                    await uploadMedia({ token: account.token, toUser: userId, contextToken, filePath: media, baseUrl: account.baseUrl });
                }
                catch { /* ignore */ }
            }
            await sendTypingIfPossible(account, userId, contextToken, 2);
            return { content: [{ type: 'text', text: `已发送 ${chunks.length} 段${media ? ' + 媒体' : ''}` }] };
        }
        catch (err) {
            return { content: [{ type: 'text', text: `发送失败: ${String(err)}` }], isError: true };
        }
    }
    if (name === 'notify') {
        const content = args?.content;
        if (!content)
            return { content: [{ type: 'text', text: '缺少 content' }], isError: true };
        try {
            await pushToUser(content);
            return { content: [{ type: 'text', text: '通知已发送' }] };
        }
        catch (err) {
            return { content: [{ type: 'text', text: `发送失败: ${String(err)}` }], isError: true };
        }
    }
    return { content: [{ type: 'text', text: `未知工具: ${name}` }], isError: true };
});
// ─── Typing ────────────────────────────────────────────
async function sendTypingIfPossible(account, userId, contextToken, status) {
    try {
        let ticket = typingTicketCache.get(userId);
        if (!ticket) {
            const config = await getConfig(account.token, userId, contextToken, account.baseUrl);
            ticket = config.typing_ticket ?? '';
            if (ticket)
                typingTicketCache.set(userId, ticket);
        }
        if (ticket)
            await sendTyping(account.token, userId, ticket, status, account.baseUrl);
    }
    catch { /* ignore */ }
}
// ─── 轮询循环 ─────────────────────────────────────────
async function pollLoop(account) {
    let buf = loadSyncBuf();
    let consecutiveFailures = 0;
    let sessionRetries = 0;
    let retryDelay = INITIAL_RETRY_DELAY_MS;
    let nextTimeoutMs;
    while (pollingActive && !pollingAbort?.signal.aborted) {
        try {
            const resp = await getUpdates(account.token, buf, account.baseUrl, nextTimeoutMs);
            if (resp.longpolling_timeout_ms)
                nextTimeoutMs = resp.longpolling_timeout_ms;
            if ((resp.ret !== undefined && resp.ret !== 0) || (resp.errcode !== undefined && resp.errcode !== 0)) {
                const errcode = resp.errcode ?? resp.ret ?? 0;
                if (errcode === SESSION_EXPIRED_ERRCODE) {
                    sessionRetries++;
                    if (sessionRetries >= MAX_SESSION_RETRIES) {
                        pollingActive = false;
                        server.notification({ method: 'notifications/message', params: { level: 'error', data: 'WeChat session expired' } });
                        return;
                    }
                    await sleep(SESSION_PAUSE_MS, pollingAbort?.signal);
                    continue;
                }
                consecutiveFailures++;
                if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                    await sleep(SESSION_PAUSE_MS, pollingAbort?.signal);
                    consecutiveFailures = 0;
                }
                else {
                    await sleep(retryDelay, pollingAbort?.signal);
                    retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY_MS);
                }
                continue;
            }
            consecutiveFailures = 0;
            retryDelay = INITIAL_RETRY_DELAY_MS;
            if (resp.get_updates_buf) {
                buf = resp.get_updates_buf;
                saveSyncBuf(buf);
            }
            for (const msg of resp.msgs ?? []) {
                if (msg.message_type !== 1)
                    continue;
                const fromUser = msg.from_user_id ?? '';
                const contextToken = msg.context_token ?? '';
                // 访问控制
                if (!isUserTrusted(fromUser)) {
                    process.stderr.write(`[wcc] 拒绝未授权用户: ${fromUser}\n`);
                    continue;
                }
                // 更新用户上下文
                lastUserId = fromUser;
                lastContextToken = contextToken;
                saveLastUser({ userId: fromUser, contextToken, savedAt: new Date().toISOString() });
                const text = await extractText(msg);
                trackMessage('sent', text);
                // 缓存 typing ticket
                try {
                    const config = await getConfig(account.token, fromUser, contextToken, account.baseUrl);
                    if (config.typing_ticket)
                        typingTicketCache.set(fromUser, config.typing_ticket);
                }
                catch { /* ignore */ }
                // 处理命令
                const consumed = await handleCommand(text, fromUser, contextToken);
                if (consumed)
                    continue;
                // 记录历史
                const histId = addHistory(fromUser, text);
                activeHistoryId.set(fromUser, histId);
                // 启动进度推送定时器
                startProgressTimer(fromUser, contextToken);
                // 发送 typing
                try {
                    const ticket = typingTicketCache.get(fromUser);
                    if (ticket)
                        await sendTyping(account.token, fromUser, ticket, 1, account.baseUrl);
                }
                catch { /* ignore */ }
                // 通知 Claude
                server.notification({
                    method: 'notifications/claude/channel',
                    params: {
                        content: text,
                        meta: {
                            source: 'wechat-channel',
                            user_id: fromUser,
                            context_token: contextToken,
                            message_id: String(msg.message_id ?? ''),
                            session_id: msg.session_id ?? '',
                        },
                    },
                });
            }
        }
        catch (err) {
            if (pollingAbort?.signal.aborted)
                return;
            consecutiveFailures++;
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                await sleep(SESSION_PAUSE_MS, pollingAbort?.signal);
                consecutiveFailures = 0;
            }
            else {
                await sleep(retryDelay, pollingAbort?.signal);
                retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY_MS);
            }
        }
    }
}
// ─── 定时任务检查 ─────────────────────────────────────
function startSchedulerLoop() {
    setInterval(async () => {
        const due = getDueJobs();
        for (const job of due) {
            markJobRun(job.id);
            process.stderr.write(`[wcc] 执行定时任务 ${job.id}: ${job.task.slice(0, 40)}\n`);
            // 发送给 Claude 执行
            server.notification({
                method: 'notifications/claude/channel',
                params: {
                    content: `[定时任务] ${job.task}`,
                    meta: { source: 'wechat-channel', user_id: job.userId, context_token: job.contextToken, message_id: '', session_id: '' },
                },
            });
            // 通知用户
            await pushToUser(`⏰ 定时任务已触发\n→ ${job.task.slice(0, 60)}`, job.userId, job.contextToken).catch(() => { });
        }
    }, 60_000); // 每分钟检查一次
}
// ─── 轮询控制 ─────────────────────────────────────────
function startPolling() {
    const account = getActiveAccount();
    if (!account || pollingActive)
        return;
    pollingActive = true;
    pollingAbort = new AbortController();
    pollLoop(account).catch(err => {
        if (!pollingAbort?.signal.aborted)
            process.stderr.write(`[wcc] Poll crashed: ${String(err)}\n`);
        pollingActive = false;
    });
}
// ─── 主入口 ───────────────────────────────────────────
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write('[wcc] wechat-claude-code v1.0.0 started\n');
    // 审批监视器
    watchApprovals(async (req) => {
        // 先检查白名单
        const decision = checkRule(req.tool_name, req.tool_input);
        if (decision === 'allow') {
            respondToApproval(req.id, 'allow');
            process.stderr.write(`[wcc] 白名单自动允许: ${req.tool_name}\n`);
            return;
        }
        if (decision === 'deny') {
            respondToApproval(req.id, 'deny');
            process.stderr.write(`[wcc] 白名单自动拒绝: ${req.tool_name}\n`);
            await pushToUser(`❌ 已自动拒绝（白名单规则）: ${req.tool_name}`).catch(() => { });
            return;
        }
        // 发送到微信等待审批
        await pushToUser(formatApprovalRequest(req)).catch(() => { });
    });
    // 定时任务调度器
    startSchedulerLoop();
    const account = getActiveAccount();
    if (account) {
        process.stderr.write(`[wcc] Account: ${account.botId}\n`);
        startPolling();
    }
    else {
        process.stderr.write('[wcc] No account. Use login tool.\n');
    }
}
main().catch(err => {
    process.stderr.write(`[wcc] Fatal: ${String(err)}\n`);
    process.exit(1);
});
//# sourceMappingURL=server.js.map