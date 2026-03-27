# wechat-claude-code

通过微信远程控制 Claude Code。扫码登录后，直接在微信里给 Claude 发任务、审批操作、中断执行、接收完成通知。

---

## 功能

### 基础功能
- **微信对话**：直接在微信里给 Claude 发消息，Claude 在本地执行后把结果发回微信
- **图片 / 文件传输**：发图片给 Claude 让它分析，Claude 生成的文件也能回传微信
- **语音消息**：自动提取转写文字后转发给 Claude

### 新增功能

#### 权限审批
开启后，Claude 每次执行 Bash 命令、写文件、编辑文件前，会先发微信问你是否允许：

```
⚠️ Claude 请求执行操作
工具: Bash
命令: rm -rf dist/

回复 y 允许，n 拒绝
(ID: a1b2c3d4)
```

回复 `y` 放行，回复 `n` 拒绝。默认关闭，需手动开启。

#### 任务完成通知
Claude 完成任务后自动推送微信通知，无需盯着终端等。

#### 中断控制
在微信发 `/stop`，立即中断 Claude 正在执行的任务。

#### 主动推送
Claude 可以主动向微信发消息（如任务完成摘要、发现错误等），无需你先发消息触发。

---

## 环境要求

- Claude Code v2.1.80+
- Node.js >= 22
- 微信（iOS / Android / macOS / Windows）

---

## 安装

```bash
git clone https://github.com/Conn-Ho/wechat-claude-code.git
cd wechat-claude-code
```

无需编译，`dist/` 已包含在仓库中。

---

## 使用步骤

### 第一步：注册 MCP + 扫码登录

```bash
node dist/cli.js install
```

终端会显示二维码，用微信扫码登录。登录成功后账号信息保存在 `~/.claude/channels/wechat/`。

### 第二步：Patch Claude Code

Claude Code 默认关闭 Channels 功能，需要打补丁启用：

```bash
node dist/cli.js patch
```

恢复原始版本：

```bash
node dist/cli.js unpatch
```

### 第三步：启动

```bash
/opt/homebrew/bin/claude --dangerously-load-development-channels server:wechat-channel
```

启动后在微信给登录的账号发消息，即可开始使用。

---

## 微信命令

| 命令 | 说明 |
|------|------|
| `y` | 允许最新的待审批操作 |
| `n` | 拒绝最新的待审批操作 |
| `y <id>` | 允许指定 ID 的操作（如 `y a1b2c3d4`） |
| `n <id>` | 拒绝指定 ID 的操作 |
| `/stop` | 中断 Claude 当前任务 |
| `/status` | 查看运行状态和待审批列表 |
| `/help` | 显示帮助 |

其他任何消息都会直接发给 Claude 执行。

---

## 可选：开启权限审批

**第一步：安装 hooks**

```bash
node dist/cli.js install-hooks
```

这会在 `~/.claude/settings.json` 里注册 `PreToolUse` 和 `Stop` 两个 hook。

**第二步：开启审批模式**

```bash
touch ~/.claude/channels/wechat/approval-mode
```

开启后，Claude 执行 Bash / Write / Edit / MultiEdit 前都会发微信等待审批。

**关闭审批模式（恢复无拦截）：**

```bash
rm ~/.claude/channels/wechat/approval-mode
```

> 审批超时（2分钟）后自动放行，不会卡死。

**移除 hooks：**

```bash
node dist/cli.js remove-hooks
```

---

## 所有 CLI 命令

```bash
node dist/cli.js install         # 注册 MCP server + 扫码登录
node dist/cli.js login           # 重新扫码登录（session 过期时使用）
node dist/cli.js patch           # 为 Claude Code 打补丁启用 Channels
node dist/cli.js unpatch         # 恢复原始 Claude Code
node dist/cli.js install-hooks   # 安装 hooks（审批拦截 + 完成通知）
node dist/cli.js remove-hooks    # 移除已安装的 hooks
node dist/cli.js status          # 查看当前登录状态
node dist/cli.js help            # 显示帮助
```

---

## 工作原理

### 消息流

```
微信消息
  → 腾讯 iLink Bot API（云端长轮询）
  → 本地 MCP Server（接收消息）
  → Claude Code（执行任务）
  → MCP Server（调用 reply tool）
  → iLink API sendmessage
  → 微信
```

### 权限审批流程

```
Claude 调用工具（Bash / Write / Edit）
  → PreToolUse hook 触发（仅 approval-mode 开启时）
  → 写入 /tmp/wcc-approval-{id}.pending
  → MCP Server 检测到文件 → 发微信审批请求
  → 用户回复 y/n
  → MCP Server 写入 /tmp/wcc-approval-{id}.result
  → hook 读取结果：exit 0（允许）/ exit 2（拒绝）
```

### 任务完成通知

Stop hook 在 Claude 完成响应后触发，读取 `~/.claude/channels/wechat/last-user.json` 中保存的用户上下文，调用 iLink API 发送通知。

### 中断控制

`/stop` 命令触发后，MCP Server 执行 `process.kill(process.ppid, 'SIGINT')`，向父进程 Claude Code 发送中断信号。

---

## 注意事项

- 单账号限制（iLink Bot API 限制）
- 用户需先发一条消息，Claude 才能回复（context_token 按消息签发）
- Session 会过期，过期后重新扫码：`node dist/cli.js login`
- patch 仅对 npm 全局安装的 Claude Code（cli.js）有效，原生二进制版本自动识别并跳转

---

## License

MIT
