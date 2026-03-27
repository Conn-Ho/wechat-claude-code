/**
 * 定时任务调度器
 * 存储位置: ~/.claude/channels/wechat/jobs.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { getStateDir } from './store.js';
function getJobsFile() {
    return path.join(getStateDir(), 'jobs.json');
}
export function loadJobs() {
    try {
        return JSON.parse(fs.readFileSync(getJobsFile(), 'utf-8'));
    }
    catch {
        return [];
    }
}
function saveJobs(jobs) {
    fs.writeFileSync(getJobsFile(), JSON.stringify(jobs, null, 2), 'utf-8');
}
export function addJob(params) {
    const jobs = loadJobs();
    const job = { ...params, id: Date.now().toString(36), createdAt: new Date().toISOString(), enabled: true };
    jobs.push(job);
    saveJobs(jobs);
    return job;
}
export function removeJob(id) {
    const jobs = loadJobs();
    const filtered = jobs.filter(j => j.id !== id);
    if (filtered.length === jobs.length)
        return false;
    saveJobs(filtered);
    return true;
}
export function markJobRun(id) {
    const jobs = loadJobs();
    const job = jobs.find(j => j.id === id);
    if (job) {
        job.lastRun = new Date().toISOString();
        if (job.type === 'once')
            job.enabled = false;
        saveJobs(jobs);
    }
}
/** 返回当前应该执行的任务 */
export function getDueJobs() {
    const now = new Date();
    return loadJobs().filter(j => {
        if (!j.enabled)
            return false;
        if (j.type === 'once') {
            const [h, m] = j.schedule.split(':').map(Number);
            if (now.getHours() !== h || now.getMinutes() !== m)
                return false;
            if (j.lastRun && new Date(j.lastRun).toDateString() === now.toDateString())
                return false;
            return true;
        }
        // cron
        if (!matchCron(j.schedule, now))
            return false;
        if (j.lastRun && now.getTime() - new Date(j.lastRun).getTime() < 60_000)
            return false;
        return true;
    });
}
function matchCron(expr, d) {
    const [min, hour, day, month, wd] = expr.trim().split(/\s+/);
    if (!min)
        return false;
    return matchF(min, d.getMinutes()) && matchF(hour, d.getHours()) &&
        matchF(day, d.getDate()) && matchF(month, d.getMonth() + 1) && matchF(wd, d.getDay());
}
function matchF(f, v) {
    if (!f || f === '*')
        return true;
    if (f.includes(','))
        return f.split(',').some(x => matchF(x, v));
    if (f.includes('/'))
        return v % parseInt(f.split('/')[1]) === 0;
    return parseInt(f) === v;
}
export function formatJobs() {
    const jobs = loadJobs().filter(j => j.enabled);
    if (jobs.length === 0)
        return '暂无定时任务';
    return jobs.map(j => `[${j.id}] ${j.type === 'once' ? '⏰' : '🔄'} ${j.schedule}\n   → ${j.task.slice(0, 50)}${j.task.length > 50 ? '...' : ''}`).join('\n');
}
export function parseScheduleCommand(text) {
    // /schedule 09:00 "task" 或 /schedule 09:00 task
    const onceM = /^\/schedule\s+(\d{1,2}:\d{2})\s+"([^"]+)"/.exec(text)
        || /^\/schedule\s+(\d{1,2}:\d{2})\s+(.+)/.exec(text);
    if (onceM)
        return { type: 'once', schedule: onceM[1].padStart(5, '0'), task: onceM[2].trim() };
    // /cron "expr" "task"
    const cronM = /^\/cron\s+"([^"]+)"\s+"([^"]+)"/.exec(text)
        || /^\/cron\s+(.+?)\s+"([^"]+)"$/.exec(text);
    if (cronM)
        return { type: 'cron', schedule: cronM[1].trim(), task: cronM[2].trim() };
    return null;
}
//# sourceMappingURL=scheduler.js.map