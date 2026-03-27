/**
 * 权限审批 IPC — 基于文件的跨进程通信
 *
 * 流程:
 *   1. hooks/pre-tool-use.sh 写入 /tmp/wcc-approval-{id}.pending
 *   2. MCP Server 检测到文件，发送微信消息请求审批
 *   3. 用户回复 y/n，MCP Server 写入 /tmp/wcc-approval-{id}.result
 *   4. hook 读取结果文件，exit 0 (allow) 或 exit 2 (deny)
 */
export interface ApprovalRequest {
    id: string;
    tool_name: string;
    tool_input: Record<string, unknown>;
    session_id?: string;
}
/** 当前待审批的请求（id → request） */
export declare const pendingApprovals: Map<string, ApprovalRequest>;
/** 写入审批结果，hook 脚本轮询读取此文件 */
export declare function respondToApproval(id: string, decision: 'allow' | 'deny'): boolean;
/** 响应最早的待审批请求（用户直接发 y/n 时） */
export declare function respondToLatest(decision: 'allow' | 'deny'): ApprovalRequest | null;
/** 格式化审批请求为易读的微信消息 */
export declare function formatApprovalRequest(req: ApprovalRequest): string;
/** 启动文件监视器，每 500ms 轮询 /tmp 目录 */
export declare function watchApprovals(onRequest: (req: ApprovalRequest) => void): void;
