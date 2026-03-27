/**
 * 用户访问控制
 * 未设置时所有人可访问（向后兼容）
 * 存储位置: ~/.claude/channels/wechat/trusted-users.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { getStateDir } from './store.js';

export interface TrustedUser {
  userId: string;
  nickname?: string;
  addedAt: string;
}

function getUsersFile(): string {
  return path.join(getStateDir(), 'trusted-users.json');
}

export function loadTrustedUsers(): TrustedUser[] {
  try {
    return JSON.parse(fs.readFileSync(getUsersFile(), 'utf-8')) as TrustedUser[];
  } catch {
    return [];
  }
}

function saveTrustedUsers(users: TrustedUser[]): void {
  fs.writeFileSync(getUsersFile(), JSON.stringify(users, null, 2), 'utf-8');
}

export function addTrustedUser(userId: string, nickname?: string): boolean {
  const users = loadTrustedUsers();
  if (users.find(u => u.userId === userId)) return false;
  users.push({ userId, nickname, addedAt: new Date().toISOString() });
  saveTrustedUsers(users);
  return true;
}

export function removeTrustedUser(userId: string): boolean {
  const users = loadTrustedUsers();
  const filtered = users.filter(u => u.userId !== userId);
  if (filtered.length === users.length) return false;
  saveTrustedUsers(filtered);
  return true;
}

/** 未设置白名单时返回 true（向后兼容） */
export function isUserTrusted(userId: string): boolean {
  const users = loadTrustedUsers();
  if (users.length === 0) return true;
  return users.some(u => u.userId === userId);
}

export function formatUsers(): string {
  const users = loadTrustedUsers();
  if (users.length === 0) return '未设置白名单（所有用户均可访问）';
  return users.map((u, i) =>
    `${i + 1}. ${u.nickname ? `${u.nickname} ` : ''}(${u.userId.slice(0, 12)}...)`
  ).join('\n');
}
