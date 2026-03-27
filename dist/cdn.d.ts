/** AES-128-ECB 加密（PKCS7 padding 由 Node.js 自动处理） */
export declare function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer;
/** AES-128-ECB 解密 */
export declare function decryptAesEcb(ciphertext: Buffer, key: Buffer): Buffer;
/** 计算 AES-ECB PKCS7 padding 后的密文大小 */
export declare function aesEcbPaddedSize(plaintextSize: number): number;
/**
 * 上传媒体文件到微信 CDN 并发送消息
 * @param params.token - Bot 认证 token
 * @param params.toUser - 目标用户 ID
 * @param params.contextToken - 会话上下文 token
 * @param params.filePath - 本地文件路径
 * @param params.baseUrl - iLink API 基址（可选）
 * @param params.cdnBaseUrl - CDN 基址（可选）
 */
export declare function uploadMedia(params: {
    token: string;
    toUser: string;
    contextToken: string;
    filePath: string;
    baseUrl?: string;
    cdnBaseUrl?: string;
}): Promise<void>;
/**
 * 从微信 CDN 下载并解密媒体文件
 * @param params.encryptQueryParam - CDN 加密查询参数
 * @param params.aesKeyBase64 - Base64 编码的 AES key
 * @param params.cdnBaseUrl - CDN 基址（可选）
 * @param params.outDir - 输出目录（可选，默认临时目录）
 * @param params.fileName - 输出文件名（可选）
 * @returns 文件绝对路径
 */
export declare function downloadMedia(params: {
    encryptQueryParam: string;
    aesKeyBase64: string;
    cdnBaseUrl?: string;
    outDir?: string;
    fileName?: string;
}): Promise<string>;
