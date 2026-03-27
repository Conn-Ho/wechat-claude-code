/**
 * cc-wechat CDN 媒体操作 — AES-128-ECB 加解密 + 上传/下载
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { apiFetch, buildHeaders, getUploadUrl, buildBaseInfo } from './ilink-api.js';

const CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';

// ─── AES-128-ECB 加解密 ──────────────────────────────

/** AES-128-ECB 加密（PKCS7 padding 由 Node.js 自动处理） */
export function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = crypto.createCipheriv('aes-128-ecb', key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

/** AES-128-ECB 解密 */
export function decryptAesEcb(ciphertext: Buffer, key: Buffer): Buffer {
  const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** 计算 AES-ECB PKCS7 padding 后的密文大小 */
export function aesEcbPaddedSize(plaintextSize: number): number {
  return Math.ceil((plaintextSize + 1) / 16) * 16;
}

// ─── 文件类型检测 ─────────────────────────────────────

/** 通过文件头 magic bytes 检测扩展名 */
function detectExtByMagic(buf: Buffer): string {
  if (buf.length < 4) return '';
  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return '.jpg';
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return '.png';
  // GIF: 47 49 46 38
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return '.gif';
  // BMP: 42 4D
  if (buf[0] === 0x42 && buf[1] === 0x4D) return '.bmp';
  // WEBP: 52 49 46 46 ... 57 45 42 50
  if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57 && buf[9] === 0x45) return '.webp';
  // MP4: ... 66 74 79 70 (ftyp at offset 4)
  if (buf.length >= 8 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return '.mp4';
  // PDF: 25 50 44 46
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return '.pdf';
  return '';
}

/** 根据扩展名检测媒体类型：IMAGE=1, VIDEO=2, FILE=3 */
function detectMediaType(filePath: string): number {
  const ext = path.extname(filePath).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext)) return 1;
  if (['.mp4', '.mov', '.avi', '.mkv'].includes(ext)) return 2;
  return 3;
}

// ─── 上传媒体 ─────────────────────────────────────────

/**
 * 上传媒体文件到微信 CDN 并发送消息
 * @param params.token - Bot 认证 token
 * @param params.toUser - 目标用户 ID
 * @param params.contextToken - 会话上下文 token
 * @param params.filePath - 本地文件路径
 * @param params.baseUrl - iLink API 基址（可选）
 * @param params.cdnBaseUrl - CDN 基址（可选）
 */
export async function uploadMedia(params: {
  token: string;
  toUser: string;
  contextToken: string;
  filePath: string;
  baseUrl?: string;
  cdnBaseUrl?: string;
}): Promise<void> {
  const { token, toUser, contextToken, filePath, baseUrl, cdnBaseUrl } = params;

  // 1. 读取文件
  const fileData = fs.readFileSync(filePath);
  const rawsize = fileData.length;
  const rawfilemd5 = crypto.createHash('md5').update(fileData).digest('hex');

  // 2. 生成 AES key 并检测媒体类型
  const aesKey = crypto.randomBytes(16);
  const mediaType = detectMediaType(filePath);

  // 3. 加密文件
  const ciphertext = encryptAesEcb(fileData, aesKey);

  // 4. 构造 filekey
  const extname = path.extname(filePath);
  const rand = crypto.randomBytes(3).toString('hex');
  const filekey = `cc-wechat-${Date.now()}-${rand}${extname}`;

  // 5. 获取上传地址
  const uploadResp = await getUploadUrl(token, {
    filekey,
    media_type: mediaType,
    to_user_id: toUser,
    rawsize,
    rawfilemd5,
    filesize: ciphertext.length,
    no_need_thumb: true,
    aeskey: aesKey.toString('hex'),
    base_info: buildBaseInfo(),
  }, baseUrl);

  const uploadParam = uploadResp.upload_param ?? '';
  const serverFilekey = uploadResp.filekey ?? filekey;

  // 6. 上传到 CDN
  const cdnUrl =
    `${cdnBaseUrl ?? CDN_BASE_URL}/upload` +
    `?encrypted_query_param=${encodeURIComponent(uploadParam)}` +
    `&filekey=${encodeURIComponent(serverFilekey)}`;

  const authHeaders = buildHeaders(token);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

  let downloadParam: string;
  try {
    const cdnResp = await fetch(cdnUrl, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/octet-stream',
      },
      body: new Uint8Array(ciphertext) as unknown as BodyInit,
      signal: controller.signal,
    });
    if (!cdnResp.ok) {
      const errText = await cdnResp.text();
      throw new Error(`[uploadMedia] CDN HTTP ${cdnResp.status}: ${errText}`);
    }
    downloadParam = cdnResp.headers.get('x-encrypted-param') ?? '';
  } finally {
    clearTimeout(timer);
  }

  // 7. 构造媒体信息
  const aesKeyBase64 = Buffer.from(aesKey.toString('hex')).toString('base64');
  const mediaInfo = {
    encrypt_query_param: downloadParam,
    aes_key: aesKeyBase64,
    encrypt_type: 1,
  };

  // 8. 根据媒体类型构造 MessageItem
  let mediaItem: Record<string, unknown>;
  if (mediaType === 1) {
    // 图片
    mediaItem = { type: 2, image_item: { media: mediaInfo, mid_size: ciphertext.length } };
  } else if (mediaType === 2) {
    // 视频
    mediaItem = { type: 5, video_item: { media: mediaInfo, video_size: ciphertext.length } };
  } else {
    // 文件
    mediaItem = {
      type: 4,
      file_item: {
        media: mediaInfo,
        file_name: path.basename(filePath),
        len: String(rawsize),
        md5: rawfilemd5,
      },
    };
  }

  // 9. 发送消息
  const clientId = `cc-wechat-${crypto.randomBytes(4).toString('hex')}`;
  const body = JSON.stringify({
    msg: {
      from_user_id: '',
      to_user_id: toUser,
      client_id: clientId,
      message_type: 2,
      message_state: 2,
      item_list: [mediaItem],
      context_token: contextToken,
    },
    base_info: buildBaseInfo(),
  });

  await apiFetch({
    baseUrl,
    endpoint: 'ilink/bot/sendmessage',
    body,
    token,
    timeoutMs: 10_000,
    label: 'uploadMedia',
  });
}

// ─── 下载媒体 ─────────────────────────────────────────

/**
 * 从微信 CDN 下载并解密媒体文件
 * @param params.encryptQueryParam - CDN 加密查询参数
 * @param params.aesKeyBase64 - Base64 编码的 AES key
 * @param params.cdnBaseUrl - CDN 基址（可选）
 * @param params.outDir - 输出目录（可选，默认临时目录）
 * @param params.fileName - 输出文件名（可选）
 * @returns 文件绝对路径
 */
export async function downloadMedia(params: {
  encryptQueryParam: string;
  aesKeyBase64: string;
  cdnBaseUrl?: string;
  outDir?: string;
  fileName?: string;
}): Promise<string> {
  const { encryptQueryParam, aesKeyBase64, cdnBaseUrl, outDir, fileName } = params;

  // 1. 构造下载 URL
  const downloadUrl =
    `${cdnBaseUrl ?? CDN_BASE_URL}/download` +
    `?encrypted_query_param=${encodeURIComponent(encryptQueryParam)}`;

  // 2. 下载密文
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

  let ciphertext: Buffer;
  try {
    const resp = await fetch(downloadUrl, { signal: controller.signal });
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`[downloadMedia] CDN HTTP ${resp.status}: ${errText}`);
    }
    ciphertext = Buffer.from(await resp.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }

  // 3. 解码 AES key（base64 → hex string → 16 字节 key）
  const hexStr = Buffer.from(aesKeyBase64, 'base64').toString('utf-8');
  const aesKey = Buffer.from(hexStr, 'hex');

  // 4. 解密
  const plaintext = decryptAesEcb(ciphertext, aesKey);

  // 5. 通过文件头检测类型并加后缀
  const ext = detectExtByMagic(plaintext);
  const targetDir = outDir ?? path.join(os.tmpdir(), 'cc-wechat', 'media');
  fs.mkdirSync(targetDir, { recursive: true });

  let targetName = fileName ?? `media-${Date.now()}`;
  // 如果文件名没有后缀，根据 magic bytes 补上
  if (!path.extname(targetName) && ext) {
    targetName += ext;
  }
  const targetPath = path.join(targetDir, targetName);
  fs.writeFileSync(targetPath, plaintext);

  return path.resolve(targetPath);
}
