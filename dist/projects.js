/**
 * 多项目管理
 * 存储位置: ~/.claude/channels/wechat/projects.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { getStateDir } from './store.js';
function getProjectsFile() {
    return path.join(getStateDir(), 'projects.json');
}
function getActiveFile() {
    return path.join(getStateDir(), 'active-project.txt');
}
export function loadProjects() {
    try {
        return JSON.parse(fs.readFileSync(getProjectsFile(), 'utf-8'));
    }
    catch {
        return [];
    }
}
function saveProjects(projects) {
    fs.writeFileSync(getProjectsFile(), JSON.stringify(projects, null, 2), 'utf-8');
}
export function addProject(name, dir) {
    const projects = loadProjects();
    if (projects.find(p => p.name === name))
        return false;
    projects.push({ name, dir, addedAt: new Date().toISOString() });
    saveProjects(projects);
    return true;
}
export function removeProject(name) {
    const projects = loadProjects();
    const filtered = projects.filter(p => p.name !== name);
    if (filtered.length === projects.length)
        return false;
    saveProjects(filtered);
    return true;
}
export function getActiveProject() {
    try {
        return fs.readFileSync(getActiveFile(), 'utf-8').trim() || null;
    }
    catch {
        return null;
    }
}
export function setActiveProject(name) {
    fs.writeFileSync(getActiveFile(), name, 'utf-8');
}
export function findProject(name) {
    return loadProjects().find(p => p.name === name) ?? null;
}
export function formatProjects() {
    const projects = loadProjects();
    const active = getActiveProject();
    if (projects.length === 0)
        return '暂无项目\n使用 /project add <名称> <路径> 添加';
    return projects.map(p => `${p.name === active ? '▶ ' : '  '}${p.name}  ${p.dir}`).join('\n');
}
//# sourceMappingURL=projects.js.map