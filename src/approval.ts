/**
 * 权限审批 IPC — 基于文件的跨进程通信
 *
 * 流程:
 *   1. hooks/pre-tool-use.sh 写入 /tmp/wcc-approval-{id}.pending
 *   2. MCP Server 检测到文件，发送微信消息请求审批
 *   3. 用户回复 y/n，MCP Server 写入 /tmp/wcc-approval-{id}.result
 *   4. hook 读取结果文件，exit 0 (allow) 或 exit 2 (deny)
 */

import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

export interface ApprovalRequest {
  id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  session_id?: string;
}

const TMP = tmpdir();
const PENDING_RE = /^wcc-approval-([a-f0-9]{16})\.pending$/;

/** 当前待审批的请求（id → request） */
export const pendingApprovals = new Map<string, ApprovalRequest>();

/** 写入审批结果，hook 脚本轮询读取此文件 */
export function respondToApproval(id: string, decision: 'allow' | 'deny'): boolean {
  if (!pendingApprovals.has(id)) return false;
  const resultFile = path.join(TMP, `wcc-approval-${id}.result`);
  fs.writeFileSync(resultFile, JSON.stringify({ decision }), 'utf-8');
  pendingApprovals.delete(id);
  return true;
}

/** 响应最早的待审批请求（用户直接发 y/n 时） */
export function respondToLatest(decision: 'allow' | 'deny'): ApprovalRequest | null {
  const [id] = pendingApprovals.keys();
  if (!id) return null;
  const req = pendingApprovals.get(id)!;
  respondToApproval(id, decision);
  return req;
}

/** 格式化审批请求为易读的微信消息 */
export function formatApprovalRequest(req: ApprovalRequest): string {
  const inputStr = formatToolInput(req.tool_name, req.tool_input);
  return [
    `⚠️ Claude 请求执行操作`,
    `工具: ${req.tool_name}`,
    inputStr,
    ``,
    `回复 y 允许，n 拒绝`,
    `(ID: ${req.id.slice(0, 8)})`,
  ].join('\n');
}

function formatToolInput(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Bash': {
      const cmd = String(input.command ?? input.cmd ?? '');
      const desc = String(input.description ?? input.desc ?? '');
      const lines: string[] = [];
      if (cmd) lines.push(`命令: ${cmd.slice(0, 500)}`);
      if (desc) lines.push(`说明: ${desc}`);
      return lines.join('\n') || '(无命令)';
    }
    case 'Write':
      return `写入文件: ${input.file_path ?? input.path ?? ''}`;
    case 'Edit':
    case 'MultiEdit':
      return `编辑文件: ${input.file_path ?? input.path ?? ''}`;
    case 'WebFetch':
      return `请求 URL: ${input.url ?? ''}`;
    default:
      return `参数: ${JSON.stringify(input).slice(0, 300)}`;
  }
}

/** 启动文件监视器，每 500ms 轮询 /tmp 目录 */
export function watchApprovals(onRequest: (req: ApprovalRequest) => void): void {
  setInterval(() => {
    let files: string[];
    try {
      files = fs.readdirSync(TMP);
    } catch {
      return;
    }
    for (const file of files) {
      const match = PENDING_RE.exec(file);
      if (!match) continue;
      const id = match[1];
      if (pendingApprovals.has(id)) continue; // 已在处理中
      try {
        const raw = fs.readFileSync(path.join(TMP, file), 'utf-8');
        const req = JSON.parse(raw) as ApprovalRequest;
        req.id = id;
        pendingApprovals.set(id, req);
        onRequest(req);
      } catch {
        // 文件未就绪，下次再试
      }
    }
  }, 500);
}
