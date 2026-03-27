#!/usr/bin/env node
/**
 * wechat-claude-code MCP Server
 *
 * 新增功能（相比 cc-wechat）:
 *   - 权限审批：PreToolUse hook → 文件 IPC → 微信 y/n
 *   - 主动推送：notify tool + Stop hook
 *   - 中断控制：/stop 命令发送 SIGINT 给 Claude 进程
 *   - 微信命令：y / n / /stop / /status
 */
// 代理支持（必须最先导入）
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
// ─── 状态变量 ─────────────────────────────────────────
let pollingActive = false;
let pollingAbort = null;
const typingTicketCache = new Map();
// 最近一次用户上下文（用于主动推送）
let lastUserId = '';
let lastContextToken = '';
// ─── Session 过期处理常量 ─────────────────────────────
const SESSION_EXPIRED_ERRCODE = -14;
const MAX_SESSION_RETRIES = 3;
const MAX_CONSECUTIVE_FAILURES = 5;
const INITIAL_RETRY_DELAY_MS = 2_000;
const MAX_RETRY_DELAY_MS = 30_000;
const SESSION_PAUSE_MS = 5 * 60_000;
// ─── 辅助函数 ─────────────────────────────────────────
/** 可中断的 sleep */
function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
    });
}
/** 直接向用户发送消息（不经过 Claude，用于命令响应和主动推送） */
async function pushToUser(text, userId, contextToken) {
    const account = getActiveAccount();
    if (!account)
        return;
    const uid = userId ?? lastUserId;
    const token = contextToken ?? lastContextToken;
    if (!uid || !token) {
        process.stderr.write('[wcc] pushToUser: 无用户上下文，消息丢弃\n');
        return;
    }
    const chunks = chunkText(stripMarkdown(text), 3900);
    for (const chunk of chunks) {
        await sendMessage(account.token, uid, chunk, token, account.baseUrl);
    }
}
/** 从消息提取可读文本（异步，支持媒体下载） */
async function extractText(msg) {
    const parts = [];
    for (const item of msg.item_list ?? []) {
        const t = item.type ?? 0;
        if (t === MessageItemType.TEXT) {
            if (item.text_item?.text) {
                if (item.ref_msg) {
                    const refTitle = item.ref_msg.title ?? '';
                    const refText = item.ref_msg.message_item?.text_item?.text ?? '';
                    const refContent = refTitle || refText;
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
                    const filePath = await downloadMedia({
                        encryptQueryParam: item.image_item.media.encrypt_query_param,
                        aesKeyBase64: item.image_item.media.aes_key,
                    });
                    desc += `\n[附件: ${filePath}]`;
                }
                catch { /* 下载失败不阻塞 */ }
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
                    const filePath = await downloadMedia({
                        encryptQueryParam: item.file_item.media.encrypt_query_param,
                        aesKeyBase64: item.file_item.media.aes_key,
                        fileName: item.file_item.file_name,
                    });
                    desc += `\n[附件: ${filePath}]`;
                }
                catch { /* 忽略 */ }
            }
            parts.push(desc);
        }
        else if (t === MessageItemType.VIDEO) {
            parts.push('[视频]');
        }
    }
    return parts.join('\n') || '[空消息]';
}
// ─── 微信命令处理 ─────────────────────────────────────
/**
 * 解析并处理微信命令，返回 true 表示已消费（不转发给 Claude）
 */
async function handleCommand(text, userId, contextToken) {
    const trimmed = text.trim();
    // 审批响应: y / yes / n / no（支持 "y <id>" 指定具体审批）
    const approveMatch = /^([yYnN])(?:\s+([a-f0-9]{8,16}))?$/.exec(trimmed);
    if (approveMatch) {
        const isAllow = approveMatch[1].toLowerCase() === 'y';
        const decision = isAllow ? 'allow' : 'deny';
        const partialId = approveMatch[2];
        let handled;
        if (partialId) {
            // 通过 ID 前缀查找
            const fullId = [...pendingApprovals.keys()].find(id => id.startsWith(partialId));
            handled = fullId ? respondToApproval(fullId, decision) : false;
        }
        else {
            handled = respondToLatest(decision) !== null;
        }
        if (handled) {
            await pushToUser(isAllow ? '✅ 已允许操作' : '❌ 已拒绝操作', userId, contextToken);
        }
        else {
            await pushToUser('暂无待审批的操作', userId, contextToken);
        }
        return true;
    }
    // /stop — 中断当前 Claude 执行
    if (trimmed === '/stop' || trimmed === '停止') {
        try {
            process.kill(process.ppid, 'SIGINT');
            await pushToUser('⏹ 已发送中断信号', userId, contextToken);
        }
        catch (err) {
            await pushToUser(`中断失败: ${String(err)}`, userId, contextToken);
        }
        return true;
    }
    // /status — 查看当前状态
    if (trimmed === '/status' || trimmed === '/状态') {
        const pending = pendingApprovals.size;
        const lines = [
            `📊 wechat-claude-code 状态`,
            `轮询: ${pollingActive ? '运行中' : '已停止'}`,
            `待审批: ${pending} 个`,
        ];
        if (pending > 0) {
            for (const [id, req] of pendingApprovals) {
                lines.push(`  · ${req.tool_name} (${id.slice(0, 8)})`);
            }
        }
        await pushToUser(lines.join('\n'), userId, contextToken);
        return true;
    }
    // /help
    if (trimmed === '/help' || trimmed === '/帮助') {
        await pushToUser([
            '📖 可用命令',
            'y / y <id>  — 允许待审批操作',
            'n / n <id>  — 拒绝待审批操作',
            '/stop       — 中断 Claude 当前任务',
            '/status     — 查看运行状态',
            '/help       — 显示此帮助',
            '',
            '其他消息将直接发给 Claude',
        ].join('\n'), userId, contextToken);
        return true;
    }
    return false;
}
// ─── MCP Server 创建 ─────────────────────────────────
const server = new Server({ name: 'wechat-channel', version: '1.0.0' }, {
    capabilities: {
        experimental: { 'claude/channel': {} },
        tools: {},
    },
    instructions: `Messages arrive as <channel source="wechat-channel" user_id="..." context_token="..." message_id="...">.
Reply using the reply tool. Pass user_id and context_token from the channel tag.
For media: set media to an absolute local file path to send image/video/file.
For quote reply: set reply_to_message_id to the message_id from the channel tag.
When you complete a task, call the notify tool with a brief summary.
IMPORTANT: Always use the reply tool to respond to WeChat messages. Do not just output text.`,
});
// ─── Tools — ListToolsRequestSchema ──────────────────
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: 'login',
            description: '扫码登录微信。首次使用或 session 过期后运行。',
            inputSchema: { type: 'object', properties: {} },
        },
        {
            name: 'reply',
            description: '回复微信消息',
            inputSchema: {
                type: 'object',
                properties: {
                    user_id: { type: 'string', description: '微信用户 ID（来自消息 meta 的 user_id）' },
                    context_token: { type: 'string', description: '会话上下文令牌（来自消息 meta 的 context_token）' },
                    content: { type: 'string', description: '回复文本内容' },
                    media: { type: 'string', description: '可选：本地文件绝对路径，发送图片/视频/文件' },
                    reply_to_message_id: { type: 'string', description: '可选：引用回复的原消息 ID' },
                },
                required: ['user_id', 'context_token', 'content'],
            },
        },
        {
            name: 'notify',
            description: '主动向用户发送通知（任务完成、发现错误等），无需用户先发消息',
            inputSchema: {
                type: 'object',
                properties: {
                    content: { type: 'string', description: '通知内容' },
                },
                required: ['content'],
            },
        },
    ],
}));
// ─── Tools — CallToolRequestSchema ───────────────────
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    // ── login tool ──
    if (name === 'login') {
        try {
            const result = await loginBrowser();
            saveAccount({
                token: result.token,
                baseUrl: result.baseUrl ?? '',
                botId: result.accountId,
                savedAt: new Date().toISOString(),
            });
            startPolling();
            return { content: [{ type: 'text', text: `登录成功！账号 ID: ${result.accountId}` }] };
        }
        catch (err) {
            return { content: [{ type: 'text', text: `登录失败: ${String(err)}` }], isError: true };
        }
    }
    // ── reply tool ──
    if (name === 'reply') {
        const userId = args?.user_id;
        const contextToken = args?.context_token;
        const content = args?.content;
        const media = args?.media;
        const replyToMessageId = args?.reply_to_message_id;
        if (!userId || !contextToken || !content) {
            return { content: [{ type: 'text', text: '缺少必填参数: user_id, context_token, content' }], isError: true };
        }
        const account = getActiveAccount();
        if (!account) {
            return { content: [{ type: 'text', text: '未登录，请先使用 login 工具扫码登录' }], isError: true };
        }
        if (media && !fs.existsSync(media)) {
            return { content: [{ type: 'text', text: `媒体文件不存在: ${media}` }], isError: true };
        }
        try {
            await sendTypingIfPossible(account, userId, contextToken, 1);
            const plainText = stripMarkdown(content);
            const chunks = chunkText(plainText, 3900);
            for (let i = 0; i < chunks.length; i++) {
                const refId = i === 0 ? replyToMessageId : undefined;
                await sendMessage(account.token, userId, chunks[i], contextToken, account.baseUrl, refId);
            }
            let mediaError = '';
            if (media) {
                try {
                    await uploadMedia({ token: account.token, toUser: userId, contextToken, filePath: media, baseUrl: account.baseUrl });
                }
                catch (err) {
                    mediaError = `（媒体发送失败: ${String(err)}）`;
                }
            }
            await sendTypingIfPossible(account, userId, contextToken, 2);
            return { content: [{ type: 'text', text: `已发送 ${chunks.length} 段文本${media ? ' + 1 个媒体文件' : ''}${mediaError}` }] };
        }
        catch (err) {
            return { content: [{ type: 'text', text: `发送失败: ${String(err)}` }], isError: true };
        }
    }
    // ── notify tool ──
    if (name === 'notify') {
        const content = args?.content;
        if (!content) {
            return { content: [{ type: 'text', text: '缺少 content 参数' }], isError: true };
        }
        try {
            await pushToUser(content);
            return { content: [{ type: 'text', text: '通知已发送' }] };
        }
        catch (err) {
            return { content: [{ type: 'text', text: `通知发送失败: ${String(err)}` }], isError: true };
        }
    }
    return { content: [{ type: 'text', text: `未知工具: ${name}` }], isError: true };
});
// ─── Typing 辅助 ──────────────────────────────────────
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
    catch { /* typing 失败不阻塞 */ }
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
                    process.stderr.write(`[wcc] Session 过期 (${sessionRetries}/${MAX_SESSION_RETRIES})\n`);
                    if (sessionRetries >= MAX_SESSION_RETRIES) {
                        pollingActive = false;
                        server.notification({ method: 'notifications/message', params: { level: 'error', data: 'WeChat session expired, please use login tool to reconnect' } });
                        return;
                    }
                    await sleep(SESSION_PAUSE_MS, pollingAbort?.signal);
                    continue;
                }
                consecutiveFailures++;
                process.stderr.write(`[wcc] API 错误 errcode=${errcode} (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})\n`);
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
                // 更新最近用户上下文（用于主动推送）
                lastUserId = fromUser;
                lastContextToken = contextToken;
                saveLastUser({ userId: fromUser, contextToken, savedAt: new Date().toISOString() });
                const text = await extractText(msg);
                // 缓存 typing ticket
                try {
                    const config = await getConfig(account.token, fromUser, contextToken, account.baseUrl);
                    if (config.typing_ticket)
                        typingTicketCache.set(fromUser, config.typing_ticket);
                }
                catch { /* 忽略 */ }
                // 处理微信命令（y/n//stop//status//help）
                const consumed = await handleCommand(text, fromUser, contextToken);
                if (consumed)
                    continue;
                // 发送 typing 状态
                try {
                    const ticket = typingTicketCache.get(fromUser);
                    if (ticket)
                        await sendTyping(account.token, fromUser, ticket, 1, account.baseUrl);
                }
                catch { /* 忽略 */ }
                // 通知 Claude 有新消息
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
            process.stderr.write(`[wcc] 网络错误: ${String(err)} (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})\n`);
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
// ─── 轮询控制 ─────────────────────────────────────────
function startPolling() {
    const account = getActiveAccount();
    if (!account || pollingActive)
        return;
    pollingActive = true;
    pollingAbort = new AbortController();
    pollLoop(account).catch((err) => {
        if (!pollingAbort?.signal.aborted) {
            process.stderr.write(`[wcc] Poll loop crashed: ${String(err)}\n`);
        }
        pollingActive = false;
    });
}
// ─── 主入口 ───────────────────────────────────────────
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write('[wcc] MCP server started (wechat-claude-code v1.0.0)\n');
    // 启动审批监视器
    watchApprovals(async (req) => {
        process.stderr.write(`[wcc] 收到审批请求: ${req.tool_name} (${req.id})\n`);
        try {
            await pushToUser(formatApprovalRequest(req));
        }
        catch (err) {
            process.stderr.write(`[wcc] 审批通知发送失败: ${String(err)}\n`);
        }
    });
    const account = getActiveAccount();
    if (account) {
        process.stderr.write(`[wcc] Found saved account: ${account.botId}\n`);
        startPolling();
    }
    else {
        process.stderr.write('[wcc] No saved account. Use the login tool to connect.\n');
    }
}
main().catch((err) => {
    process.stderr.write(`[wcc] Fatal: ${String(err)}\n`);
    process.exit(1);
});
//# sourceMappingURL=server.js.map