export interface TrustedUser {
    userId: string;
    nickname?: string;
    addedAt: string;
}
export declare function loadTrustedUsers(): TrustedUser[];
export declare function addTrustedUser(userId: string, nickname?: string): boolean;
export declare function removeTrustedUser(userId: string): boolean;
/** 未设置白名单时返回 true（向后兼容） */
export declare function isUserTrusted(userId: string): boolean;
export declare function formatUsers(): string;
