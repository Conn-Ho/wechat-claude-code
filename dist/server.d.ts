#!/usr/bin/env node
/**
 * wechat-claude-code MCP Server
 *
 * 新增功能（相比 cc-wechat）:
 *   - 权限审批：PreToolUse hook → 文件 IPC → 微信 y/n
 *   - 主动推送：notify tool + Stop hook
 *   - 中断控制：/stop 命令发送 SIGINT 给 Claude 进程
 *   - 微信命令：y / n / /stop / /status
 */
import './proxy.js';
