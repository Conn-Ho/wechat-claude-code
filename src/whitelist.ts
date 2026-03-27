/**
 * 审批白名单 — 自动允许/拒绝特定工具调用
 * 存储位置: ~/.claude/channels/wechat/whitelist.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { getStateDir } from './store.js';

export interface WhitelistRule {
  id: number;
  type: 'allow' | 'deny';
  tool: string;      // 工具名，如 'Bash', 'Write', '*'
  pattern?: string;  // 命令/路径的匹配模式，* 为通配符，可选
  createdAt: string;
}

function getRuleFile(): string {
  return path.join(getStateDir(), 'whitelist.json');
}

export function loadRules(): WhitelistRule[] {
  try {
    return JSON.parse(fs.readFileSync(getRuleFile(), 'utf-8')) as WhitelistRule[];
  } catch {
    return [];
  }
}

function saveRules(rules: WhitelistRule[]): void {
  fs.writeFileSync(getRuleFile(), JSON.stringify(rules, null, 2), 'utf-8');
}

export function addRule(type: 'allow' | 'deny', tool: string, pattern?: string): WhitelistRule {
  const rules = loadRules();
  const id = (rules[rules.length - 1]?.id ?? 0) + 1;
  const rule: WhitelistRule = { id, type, tool, pattern, createdAt: new Date().toISOString() };
  rules.push(rule);
  saveRules(rules);
  return rule;
}

export function removeRule(id: number): boolean {
  const rules = loadRules();
  const filtered = rules.filter(r => r.id !== id);
  if (filtered.length === rules.length) return false;
  saveRules(filtered);
  return true;
}

export function clearRules(): void {
  saveRules([]);
}

/** 检查工具调用是否匹配白名单，返回 'allow' | 'deny' | 'ask' */
export function checkRule(toolName: string, toolInput: Record<string, unknown>): 'allow' | 'deny' | 'ask' {
  const rules = loadRules();
  const inputStr = getInputString(toolName, toolInput);

  for (const rule of rules) {
    if (rule.tool !== '*' && rule.tool !== toolName) continue;
    if (rule.pattern && !matchPattern(inputStr, rule.pattern)) continue;
    return rule.type;
  }
  return 'ask';
}

function getInputString(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Bash': return String(input.command ?? '');
    case 'Write': return String(input.file_path ?? input.path ?? '');
    case 'Edit': case 'MultiEdit': return String(input.file_path ?? input.path ?? '');
    default: return JSON.stringify(input).slice(0, 200);
  }
}

function matchPattern(str: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + escaped).test(str);
}

export function formatRules(): string {
  const rules = loadRules();
  if (rules.length === 0) return '暂无白名单规则';
  return rules.map(r =>
    `${r.id}. ${r.type === 'allow' ? '✅ 允许' : '❌ 拒绝'} ${r.tool}${r.pattern ? `:${r.pattern}` : ''}`
  ).join('\n');
}
