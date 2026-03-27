/**
 * 多项目管理
 * 存储位置: ~/.claude/channels/wechat/projects.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { getStateDir } from './store.js';

export interface Project {
  name: string;
  dir: string;
  addedAt: string;
}

function getProjectsFile(): string {
  return path.join(getStateDir(), 'projects.json');
}

function getActiveFile(): string {
  return path.join(getStateDir(), 'active-project.txt');
}

export function loadProjects(): Project[] {
  try {
    return JSON.parse(fs.readFileSync(getProjectsFile(), 'utf-8')) as Project[];
  } catch {
    return [];
  }
}

function saveProjects(projects: Project[]): void {
  fs.writeFileSync(getProjectsFile(), JSON.stringify(projects, null, 2), 'utf-8');
}

export function addProject(name: string, dir: string): boolean {
  const projects = loadProjects();
  if (projects.find(p => p.name === name)) return false;
  projects.push({ name, dir, addedAt: new Date().toISOString() });
  saveProjects(projects);
  return true;
}

export function removeProject(name: string): boolean {
  const projects = loadProjects();
  const filtered = projects.filter(p => p.name !== name);
  if (filtered.length === projects.length) return false;
  saveProjects(filtered);
  return true;
}

export function getActiveProject(): string | null {
  try {
    return fs.readFileSync(getActiveFile(), 'utf-8').trim() || null;
  } catch {
    return null;
  }
}

export function setActiveProject(name: string): void {
  fs.writeFileSync(getActiveFile(), name, 'utf-8');
}

export function findProject(name: string): Project | null {
  return loadProjects().find(p => p.name === name) ?? null;
}

export function formatProjects(): string {
  const projects = loadProjects();
  const active = getActiveProject();
  if (projects.length === 0) return '暂无项目\n使用 /project add <名称> <路径> 添加';
  return projects.map(p =>
    `${p.name === active ? '▶ ' : '  '}${p.name}  ${p.dir}`
  ).join('\n');
}
