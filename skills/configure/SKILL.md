---
name: configure
description: Set up the WeChat channel — scan QR code to login. Use when the user wants to connect WeChat or needs to re-login.
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Bash(node *)
  - Bash(ls *)
  - Bash(rm *)
---

# /wechat:configure — WeChat Channel Setup

## No args — status and login

1. Check `~/.claude/channels/wechat/account.json`
   - If exists: show botId (first 12 chars + "..."), savedAt. Ask if re-login needed.
   - If missing: use the `login` tool to start QR code login.

2. After success: tell user "WeChat connected! Send a message from WeChat to test."

## `logout` — remove credentials

1. Delete `~/.claude/channels/wechat/account.json`
2. Delete `~/.claude/channels/wechat/sync-buf.txt`
3. Confirm: "Logged out. Run /wechat:configure to re-login."

## `reset` — full reset

1. Delete entire `~/.claude/channels/wechat/` directory
2. Confirm: "Reset complete. Run /wechat:configure to start fresh."
