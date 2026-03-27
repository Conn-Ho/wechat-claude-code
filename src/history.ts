/**
 * 任务历史记录
 * 存储位置: ~/.claude/channels/wechat/history.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { getStateDir } from './store.js';

const MAX_HISTORY = 20;

export interface HistoryEntry {
  id: number;
  timestamp: string;
  userId: string;
  message: string;
  summary?: string;
}

function getHistoryFile(): string {
  return path.join(getStateDir(), 'history.json');
}

export function loadHistory(): HistoryEntry[] {
  try {
    return JSON.parse(fs.readFileSync(getHistoryFile(), 'utf-8')) as HistoryEntry[];
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]): void {
  fs.writeFileSync(getHistoryFile(), JSON.stringify(entries, null, 2), 'utf-8');
}

export function addHistory(userId: string, message: string): number {
  const entries = loadHistory();
  const id = (entries[entries.length - 1]?.id ?? 0) + 1;
  entries.push({ id, timestamp: new Date().toISOString(), userId, message });
  if (entries.length > MAX_HISTORY) entries.splice(0, entries.length - MAX_HISTORY);
  saveHistory(entries);
  return id;
}

export function updateSummary(id: number, summary: string): void {
  const entries = loadHistory();
  const entry = entries.find(e => e.id === id);
  if (entry) {
    entry.summary = summary.slice(0, 100);
    saveHistory(entries);
  }
}

/** 获取第 n 条历史（1 = 最新） */
export function getEntry(n: number): HistoryEntry | null {
  const entries = loadHistory();
  if (entries.length === 0 || n < 1 || n > entries.length) return null;
  return entries[entries.length - n];
}

export function formatHistory(): string {
  const entries = loadHistory();
  if (entries.length === 0) return '暂无历史记录';
  return [...entries].reverse().slice(0, 10).map((e, i) => {
    const time = new Date(e.timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const msg = e.message.slice(0, 45) + (e.message.length > 45 ? '...' : '');
    return `${i + 1}. [${time}] ${msg}`;
  }).join('\n');
}
