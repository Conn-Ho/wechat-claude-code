/**
 * cc-wechat 类型定义 — iLink Bot API 请求/响应/消息结构
 */
export declare const MessageItemType: {
    readonly NONE: 0;
    readonly TEXT: 1;
    readonly IMAGE: 2;
    readonly VOICE: 3;
    readonly FILE: 4;
    readonly VIDEO: 5;
};
export interface CDNMedia {
    encrypt_query_param?: string;
    aes_key?: string;
    encrypt_type?: number;
}
export interface MessageItem {
    type?: number;
    text_item?: {
        text?: string;
    };
    image_item?: {
        media?: CDNMedia;
        url?: string;
        mid_size?: number;
    };
    voice_item?: {
        media?: CDNMedia;
        text?: string;
        playtime?: number;
    };
    file_item?: {
        media?: CDNMedia;
        file_name?: string;
        len?: string;
        md5?: string;
    };
    video_item?: {
        media?: CDNMedia;
        video_size?: number;
    };
    ref_msg?: {
        title?: string;
        message_item?: MessageItem;
    };
    msg_id?: string;
}
export interface WeixinMessage {
    seq?: number;
    message_id?: number;
    from_user_id?: string;
    to_user_id?: string;
    client_id?: string;
    create_time_ms?: number;
    session_id?: string;
    message_type?: number;
    message_state?: number;
    item_list?: MessageItem[];
    context_token?: string;
}
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
export interface AccountData {
    token: string;
    baseUrl: string;
    botId: string;
    userId?: string;
    savedAt: string;
}
export interface LastUserContext {
    userId: string;
    contextToken: string;
    savedAt: string;
}
export interface BaseInfo {
    channel_version?: string;
}
