import type { BaseInfo, QRCodeResponse, QRStatusResponse, GetUpdatesResp, GetConfigResp, GetUploadUrlResp } from './types.js';
export declare const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
/** 构造 base_info 通用字段 */
export declare function buildBaseInfo(): BaseInfo;
/** 生成随机 wechat uin（4 字节随机数 → 十进制 → base64） */
export declare function randomWechatUin(): string;
/** 构造请求头 */
export declare function buildHeaders(token?: string, body?: string): Record<string, string>;
/** 通用 HTTP 请求 */
export declare function apiFetch(params: {
    baseUrl?: string;
    endpoint: string;
    body?: string;
    token?: string;
    timeoutMs: number;
    label: string;
    method?: string;
    extraHeaders?: Record<string, string>;
}): Promise<string>;
/** 获取登录二维码 */
export declare function getQRCode(baseUrl?: string): Promise<QRCodeResponse>;
/** 轮询二维码扫描状态（长轮询，35s 超时） */
export declare function pollQRStatus(qrcode: string, baseUrl?: string): Promise<QRStatusResponse>;
/** 长轮询获取新消息 */
export declare function getUpdates(token: string, buf: string, baseUrl?: string, timeoutMs?: number): Promise<GetUpdatesResp>;
/** 发送文本消息，返回 client_id。支持引用回复（ref_msg） */
export declare function sendMessage(token: string, to: string, text: string, contextToken: string, baseUrl?: string, refMsgId?: string): Promise<string>;
/** 发送输入状态指示 */
export declare function sendTyping(token: string, userId: string, ticket: string, status: number, baseUrl?: string): Promise<void>;
/** 获取配置（typing ticket 等） */
export declare function getConfig(token: string, userId: string, contextToken?: string, baseUrl?: string): Promise<GetConfigResp>;
/** 获取文件上传地址 */
export declare function getUploadUrl(token: string, params: Record<string, unknown>, baseUrl?: string): Promise<GetUploadUrlResp>;
