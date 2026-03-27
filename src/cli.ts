#!/usr/bin/env node
/**
 * wechat-claude-code CLI 入口
 */

// 代理支持（必须最先导入）
import './proxy.js';

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loginTerminal } from './auth.js';
import { saveAccount, getActiveAccount } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOKS_DIR = path.join(__dirname, '..', 'hooks');
const CLAUDE_SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');

// ─── help ────────────────────────────────────────────

function help(): void {
  console.log(`
  wechat-claude-code — 微信远程控制 Claude Code

  用法: npx wechat-claude-code <命令>

  命令:
    install        注册 MCP server + 扫码登录 + 安装 hooks
    login          重新扫码登录
    install-hooks  安装 Claude Code hooks（权限审批 + 完成通知）
    remove-hooks   移除已安装的 hooks
    patch          修补 Claude Code 以启用 Channels 功能
    unpatch        恢复原始 Claude Code
    status         查看连接状态
    help           显示帮助

  微信命令（登录后在微信中发送）:
    y              允许待审批操作
    n              拒绝待审批操作
    /stop          中断当前任务
    /status        查看运行状态
    /help          显示帮助
`);
}

// ─── install-hooks ───────────────────────────────────

/** 安装 Claude Code hooks 到 ~/.claude/settings.json */
function installHooks(): void {
  console.log('\n🔗 安装 Claude Code Hooks...\n');

  // 读取现有设置
  let settings: Record<string, unknown> = {};
  try {
    const raw = fs.readFileSync(CLAUDE_SETTINGS, 'utf-8');
    settings = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // 文件不存在或解析失败，使用空对象
  }

  // 复制 hook 脚本到持久化目录
  const hooksInstallDir = path.join(os.homedir(), '.claude', 'channels', 'wechat', 'hooks');
  fs.mkdirSync(hooksInstallDir, { recursive: true });

  const preToolUseSrc = path.join(HOOKS_DIR, 'pre-tool-use.sh');
  const stopSrc = path.join(HOOKS_DIR, 'stop.sh');
  const preToolUseDst = path.join(hooksInstallDir, 'pre-tool-use.sh');
  const stopDst = path.join(hooksInstallDir, 'stop.sh');

  fs.copyFileSync(preToolUseSrc, preToolUseDst);
  fs.copyFileSync(stopSrc, stopDst);
  fs.chmodSync(preToolUseDst, 0o755);
  fs.chmodSync(stopDst, 0o755);

  console.log(`  ✅ Hook 脚本已复制到: ${hooksInstallDir}`);

  // 构建 hooks 配置
  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;

  // PreToolUse hook（审批危险操作）
  const preToolUseHooks = (hooks['PreToolUse'] ?? []) as Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>;
  const wccPreEntry = {
    matcher: 'Bash|Write|Edit|MultiEdit',
    hooks: [{ type: 'command', command: `bash "${preToolUseDst}"` }],
  };
  // 移除旧的 wcc 条目
  const filteredPre = preToolUseHooks.filter(
    (e) => !e.hooks?.some((h) => h.command?.includes('wcc') || h.command?.includes('wechat-claude-code')),
  );
  hooks['PreToolUse'] = [...filteredPre, wccPreEntry];

  // Stop hook（任务完成通知）
  const stopHooks = (hooks['Stop'] ?? []) as Array<{ hooks: Array<{ type: string; command: string }> }>;
  const wccStopEntry = {
    hooks: [{ type: 'command', command: `bash "${stopDst}"` }],
  };
  const filteredStop = stopHooks.filter(
    (e) => !e.hooks?.some((h) => h.command?.includes('wcc') || h.command?.includes('wechat-claude-code')),
  );
  hooks['Stop'] = [...filteredStop, wccStopEntry];

  settings.hooks = hooks;

  // 原子写入
  const tmpFile = CLAUDE_SETTINGS + '.tmp';
  fs.mkdirSync(path.dirname(CLAUDE_SETTINGS), { recursive: true });
  fs.writeFileSync(tmpFile, JSON.stringify(settings, null, 2), 'utf-8');
  fs.renameSync(tmpFile, CLAUDE_SETTINGS);

  console.log(`  ✅ Hooks 已写入: ${CLAUDE_SETTINGS}`);
  console.log('\n  已配置:');
  console.log('    · PreToolUse (Bash/Write/Edit) → 微信审批（需手动开启 approval-mode）');
  console.log('    · Stop → 任务完成微信通知');
  console.log('\n  开启审批模式:');
  console.log('    touch ~/.claude/channels/wechat/approval-mode');
  console.log('  关闭审批模式:');
  console.log('    rm ~/.claude/channels/wechat/approval-mode\n');
}

/** 移除已安装的 hooks */
function removeHooks(): void {
  console.log('\n🗑  移除 Claude Code Hooks...\n');

  let settings: Record<string, unknown> = {};
  try {
    const raw = fs.readFileSync(CLAUDE_SETTINGS, 'utf-8');
    settings = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    console.log('  settings.json 不存在，无需移除\n');
    return;
  }

  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;

  for (const key of Object.keys(hooks)) {
    hooks[key] = (hooks[key] as Array<{ hooks?: Array<{ command?: string }> }>).filter(
      (e) => !e.hooks?.some((h) => h.command?.includes('wcc') || h.command?.includes('wechat-claude-code')),
    );
  }

  settings.hooks = hooks;

  fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2), 'utf-8');
  console.log('  ✅ Hooks 已移除\n');
}

// ─── install ─────────────────────────────────────────

/** 直接写入 ~/.claude/mcp.json 注册 MCP server（不调用 claude 命令避免循环触发 hooks） */
function registerMcp(serverPath: string): void {
  const mcpFile = path.join(os.homedir(), '.claude', 'mcp.json');
  let mcp: Record<string, unknown> = {};
  try {
    mcp = JSON.parse(fs.readFileSync(mcpFile, 'utf-8')) as Record<string, unknown>;
  } catch { /* 文件不存在，用空对象 */ }

  const servers = (mcp.mcpServers ?? {}) as Record<string, unknown>;
  servers['wechat-channel'] = {
    command: 'node',
    args: [serverPath],
  };
  mcp.mcpServers = servers;

  fs.mkdirSync(path.dirname(mcpFile), { recursive: true });
  fs.writeFileSync(mcpFile, JSON.stringify(mcp, null, 2), 'utf-8');
}

async function install(): Promise<void> {
  console.log('\n🔧 wechat-claude-code 安装向导\n');

  // [1/3] 注册 MCP server（直接写配置文件，不调用 claude 命令）
  console.log('[1/3] 注册 MCP server...');
  const serverPath = path.join(__dirname, 'server.js');
  try {
    registerMcp(serverPath);
    console.log('  ✅ MCP server 已注册');
    console.log(`  路径: ${serverPath}`);
  } catch (e) {
    console.error('  ❌ MCP server 注册失败:', (e as Error).message);
  }

  // [2/3] 微信扫码登录
  console.log('\n[2/3] 微信扫码登录...\n');
  const existing = getActiveAccount();
  if (existing) {
    console.log('  ⏭️  已有登录账号，跳过扫码');
    console.log('  如需重新登录: node ' + path.join(__dirname, 'cli.js') + ' login');
  } else {
    const { token, accountId, baseUrl } = await loginTerminal();
    saveAccount({
      token,
      baseUrl: baseUrl ?? '',
      botId: accountId.replace(/@/g, '-').replace(/\./g, '-'),
      savedAt: new Date().toISOString(),
    });
    console.log('  ✅ 登录成功');
  }

  // [3/3] 完成
  console.log('\n[3/3] 安装完成！\n');

  // 检测 claude 可执行文件路径
  const claudeBin = findClaudeBin();
  console.log('启动命令（需要先 patch）:');
  console.log(`  node ${path.join(__dirname, 'cli.js')} patch`);
  console.log(`  ${claudeBin} --dangerously-load-development-channels server:wechat-channel\n`);
  console.log('可选：开启工具审批（需要先 install-hooks）:');
  console.log(`  node ${path.join(__dirname, 'cli.js')} install-hooks`);
  console.log(`  touch ~/.claude/channels/wechat/approval-mode\n`);
  console.log('微信命令:');
  console.log('  y / n   — 审批工具调用（需开启 approval-mode）');
  console.log('  /stop   — 中断任务');
  console.log('  /status — 查看状态\n');
}

/** 查找 claude 可执行文件路径 */
function findClaudeBin(): string {
  const candidates = [
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    path.join(os.homedir(), '.npm-global', 'bin', 'claude'),
    path.join(os.homedir(), '.local', 'bin', 'claude'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return 'claude'; // fallback
}

// ─── login ───────────────────────────────────────────

async function login(): Promise<void> {
  console.log('\n🔑 微信扫码登录\n');
  const { token, accountId, baseUrl } = await loginTerminal();
  saveAccount({
    token,
    baseUrl: baseUrl ?? '',
    botId: accountId.replace(/@/g, '-').replace(/\./g, '-'),
    savedAt: new Date().toISOString(),
  });
  console.log('\n✅ 登录成功！账号已保存。\n');
}

// ─── status ──────────────────────────────────────────

function status(): void {
  const account = getActiveAccount();
  if (account) {
    console.log('\n📋 当前账号状态:\n');
    console.log(`  botId:   ${account.botId.substring(0, 12)}...`);
    console.log(`  baseUrl: ${account.baseUrl}`);
    console.log(`  savedAt: ${account.savedAt}\n`);
  } else {
    console.log(`\n❌ 尚未登录。请运行: node ${path.join(__dirname, 'cli.js')} install\n`);
  }
}

// ─── main ────────────────────────────────────────────

const command = process.argv[2];
switch (command) {
  case 'install': case 'setup': await install(); break;
  case 'login': await login(); break;
  case 'install-hooks': installHooks(); break;
  case 'remove-hooks': removeHooks(); break;
  case 'patch': case 'unpatch': {
    process.argv[2] = command;
    await import('./patch.js');
    break;
  }
  case 'status': status(); break;
  case 'help': case '--help': case '-h': case undefined: help(); break;
  default: console.error(`未知命令: ${command}`); help(); process.exit(1);
}
