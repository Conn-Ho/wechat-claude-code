#!/usr/bin/env node
/**
 * wechat-claude-code MCP Server
 *
 * 功能清单:
 *   - 微信消息 ↔ Claude Code 双向桥接
 *   - 权限审批（白名单规则 + y/n 确认）
 *   - 任务完成推送通知
 *   - 流式进度推送（30s 心跳）
 *   - 中断控制（/stop）
 *   - 多项目管理（/project add/list/switch）
 *   - 审批白名单（/allow /deny /whitelist）
 *   - 任务历史（/history /retry /redo）
 *   - 定时任务（/schedule /cron /jobs /cancel）
 *   - 用量统计（/usage）
 *   - 用户访问控制（/trust /untrust /users）
 *   - 文件请求（/get）
 */
import './proxy.js';
