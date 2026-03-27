/**
 * cc-wechat 类型定义 — iLink Bot API 请求/响应/消息结构
 */

// 消息内容类型枚举
export const MessageItemType = {
  NONE: 0,
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
} as const;

// CDN 媒体引用
export interface CDNMedia {
  encrypt_query_param?: string;
  aes_key?: string;
  encrypt_type?: number;
}

// 消息内容项
export interface MessageItem {
  type?: number;
  text_item?: { text?: string };
  image_item?: { media?: CDNMedia; url?: string; mid_size?: number };
  voice_item?: { media?: CDNMedia; text?: string; playtime?: number };
  file_item?: { media?: CDNMedia; file_name?: string; len?: string; md5?: string };
  video_item?: { media?: CDNMedia; video_size?: number };
  ref_msg?: { title?: string; message_item?: MessageItem };
  msg_id?: string;
}

// 微信消息
export interface WeixinMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  session_id?: string;
  message_type?: number;  // 1=USER, 2=BOT
  message_state?: number; // 0=NEW, 1=GENERATING, 2=FINISH
  item_list?: MessageItem[];
  context_token?: string;
}

// API 响应
export interface GetUpdatesResp {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

export interface QRCodeResponse {
  qrcode: string;
  qrcode_img_content: string;
}

export interface QRStatusResponse {
  status: 'wait' | 'scaned' | 'confirmed' | 'expired';
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
}

export interface GetConfigResp {
  ret?: number;
  typing_ticket?: string;
}

export interface GetUploadUrlResp {
  upload_param?: string;
  thumb_upload_param?: string;
  filekey?: string;
}

// 本地存储
export interface AccountData {
  token: string;
  baseUrl: string;
  botId: string;
  userId?: string;
  savedAt: string;
}

// 最近一次用户上下文（用于主动推送）
export interface LastUserContext {
  userId: string;
  contextToken: string;
  savedAt: string;
}

export interface BaseInfo {
  channel_version?: string;
}
