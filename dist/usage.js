/**
 * 用量统计 — 消息计数和 token 估算
 * 存储位置: ~/.claude/channels/wechat/usage.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { getStateDir } from './store.js';
function getUsageFile() {
    return path.join(getStateDir(), 'usage.json');
}
function today() {
    return new Date().toISOString().split('T')[0];
}
export function loadUsage() {
    try {
        return JSON.parse(fs.readFileSync(getUsageFile(), 'utf-8'));
    }
    catch {
        return {};
    }
}
function saveUsage(data) {
    fs.writeFileSync(getUsageFile(), JSON.stringify(data, null, 2), 'utf-8');
}
export function trackMessage(type, text) {
    const data = loadUsage();
    const d = today();
    if (!data[d])
        data[d] = { date: d, messagesSent: 0, messagesReceived: 0, estimatedTokens: 0 };
    if (type === 'sent')
        data[d].messagesSent++;
    else
        data[d].messagesReceived++;
    data[d].estimatedTokens += Math.ceil(text.length / 4);
    saveUsage(data);
}
export function formatUsage() {
    const data = loadUsage();
    const d = today();
    const t = data[d];
    const lines = ['📊 用量统计'];
    if (t) {
        lines.push(`\n今日 (${d})`);
        lines.push(`  发出: ${t.messagesSent} 条`);
        lines.push(`  收到: ${t.messagesReceived} 条`);
        lines.push(`  预计 token: ~${t.estimatedTokens.toLocaleString()}`);
    }
    else {
        lines.push('今日暂无数据');
    }
    const dates = Object.keys(data).sort().slice(-7);
    if (dates.length > 1) {
        const total = dates.reduce((a, k) => ({
            messagesSent: a.messagesSent + data[k].messagesSent,
            estimatedTokens: a.estimatedTokens + data[k].estimatedTokens,
        }), { messagesSent: 0, estimatedTokens: 0 });
        lines.push(`\n近 ${dates.length} 天累计`);
        lines.push(`  发出: ${total.messagesSent} 条`);
        lines.push(`  token: ~${total.estimatedTokens.toLocaleString()}`);
    }
    return lines.join('\n');
}
//# sourceMappingURL=usage.js.map