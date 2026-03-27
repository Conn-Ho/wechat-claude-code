/**
 * cc-wechat 凭证持久化 — account.json 原子写入 + sync buf
 */
import type { AccountData, LastUserContext } from './types.js';
/**
 * 获取状态目录路径，不存在则自动创建
 */
export declare function getStateDir(): string;
/**
 * 原子写入账号数据（先写 tmp 再 rename）
 */
export declare function saveAccount(data: AccountData): void;
/**
 * 读取当前活跃账号，文件不存在返回 null
 */
export declare function getActiveAccount(): AccountData | null;
/**
 * 读取 sync buf，不存在返回空字符串
 */
export declare function loadSyncBuf(): string;
/**
 * 写入 sync buf
 */
export declare function saveSyncBuf(buf: string): void;
/**
 * 保存最近一次用户上下文（用于 hook 主动推送）
 */
export declare function saveLastUser(data: LastUserContext): void;
/**
 * 读取最近一次用户上下文
 */
export declare function loadLastUser(): LastUserContext | null;
