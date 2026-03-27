/**
 * 审批白名单 — 自动允许/拒绝特定工具调用
 * 存储位置: ~/.claude/channels/wechat/whitelist.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { getStateDir } from './store.js';
function getRuleFile() {
    return path.join(getStateDir(), 'whitelist.json');
}
export function loadRules() {
    try {
        return JSON.parse(fs.readFileSync(getRuleFile(), 'utf-8'));
    }
    catch {
        return [];
    }
}
function saveRules(rules) {
    fs.writeFileSync(getRuleFile(), JSON.stringify(rules, null, 2), 'utf-8');
}
export function addRule(type, tool, pattern) {
    const rules = loadRules();
    const id = (rules[rules.length - 1]?.id ?? 0) + 1;
    const rule = { id, type, tool, pattern, createdAt: new Date().toISOString() };
    rules.push(rule);
    saveRules(rules);
    return rule;
}
export function removeRule(id) {
    const rules = loadRules();
    const filtered = rules.filter(r => r.id !== id);
    if (filtered.length === rules.length)
        return false;
    saveRules(filtered);
    return true;
}
export function clearRules() {
    saveRules([]);
}
/** 检查工具调用是否匹配白名单，返回 'allow' | 'deny' | 'ask' */
export function checkRule(toolName, toolInput) {
    const rules = loadRules();
    const inputStr = getInputString(toolName, toolInput);
    for (const rule of rules) {
        if (rule.tool !== '*' && rule.tool !== toolName)
            continue;
        if (rule.pattern && !matchPattern(inputStr, rule.pattern))
            continue;
        return rule.type;
    }
    return 'ask';
}
function getInputString(toolName, input) {
    switch (toolName) {
        case 'Bash': return String(input.command ?? '');
        case 'Write': return String(input.file_path ?? input.path ?? '');
        case 'Edit':
        case 'MultiEdit': return String(input.file_path ?? input.path ?? '');
        default: return JSON.stringify(input).slice(0, 200);
    }
}
function matchPattern(str, pattern) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp('^' + escaped).test(str);
}
export function formatRules() {
    const rules = loadRules();
    if (rules.length === 0)
        return '暂无白名单规则';
    return rules.map(r => `${r.id}. ${r.type === 'allow' ? '✅ 允许' : '❌ 拒绝'} ${r.tool}${r.pattern ? `:${r.pattern}` : ''}`).join('\n');
}
//# sourceMappingURL=whitelist.js.map