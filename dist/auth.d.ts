/**
 * QR 扫码登录 — 终端 ASCII 模式 + 浏览器弹窗模式
 */
export interface LoginResult {
    token: string;
    accountId: string;
    baseUrl?: string;
}
/**
 * 终端 ASCII 二维码登录，适用于 CLI 调用
 * 输出到 stderr 避免干扰 MCP stdio
 */
export declare function loginTerminal(baseUrl?: string): Promise<LoginResult>;
/**
 * 浏览器弹窗二维码登录，适用于 MCP 内 login tool
 * 启动本地 HTTP 服务展示二维码页面
 */
export declare function loginBrowser(baseUrl?: string): Promise<LoginResult>;
