#!/usr/bin/env bash
# wechat-claude-code Stop hook
#
# Claude 完成任务后自动触发，向微信发送完成通知。
# 读取 ~/.claude/channels/wechat/last-user.json 获取用户上下文。

set -euo pipefail

STATE_DIR="$HOME/.claude/channels/wechat"
LAST_USER_FILE="$STATE_DIR/last-user.json"
ACCOUNT_FILE="$STATE_DIR/account.json"

# 检查凭证是否存在
if [ ! -f "$LAST_USER_FILE" ] || [ ! -f "$ACCOUNT_FILE" ]; then
  exit 0
fi

# 读取账号和用户上下文
TOKEN=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('${ACCOUNT_FILE}','utf8')).token||'')" 2>/dev/null || \
  python3 -c "import json; print(json.load(open('${ACCOUNT_FILE}')).get('token',''),end='')")

BASE_URL=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('${ACCOUNT_FILE}','utf8')).baseUrl||'https://ilinkai.weixin.qq.com')" 2>/dev/null || \
  python3 -c "import json; d=json.load(open('${ACCOUNT_FILE}')); print(d.get('baseUrl','https://ilinkai.weixin.qq.com'),end='')")

USER_ID=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('${LAST_USER_FILE}','utf8')).userId||'')" 2>/dev/null || \
  python3 -c "import json; print(json.load(open('${LAST_USER_FILE}')).get('userId',''),end='')")

CONTEXT_TOKEN=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('${LAST_USER_FILE}','utf8')).contextToken||'')" 2>/dev/null || \
  python3 -c "import json; print(json.load(open('${LAST_USER_FILE}')).get('contextToken',''),end='')")

if [ -z "$TOKEN" ] || [ -z "$USER_ID" ] || [ -z "$CONTEXT_TOKEN" ]; then
  exit 0
fi

# 发送完成通知
CLIENT_ID="wcc-stop-$(date +%s%N | md5sum | head -c 8 | tr -d ' ')"

node -e "
const https = require('https');
const url = new URL('ilink/bot/sendmessage', '${BASE_URL}/');
const body = JSON.stringify({
  msg: {
    from_user_id: '',
    to_user_id: '${USER_ID}',
    client_id: '${CLIENT_ID}',
    message_type: 2,
    message_state: 2,
    item_list: [{ type: 1, text_item: { text: '✅ Claude 已完成任务' } }],
    context_token: '${CONTEXT_TOKEN}',
  },
  base_info: { channel_version: '1.0.0' },
});
const req = https.request(url.toString(), {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'AuthorizationType': 'ilink_bot_token',
    'Authorization': 'Bearer ${TOKEN}',
    'Content-Length': Buffer.byteLength(body),
  },
}, (res) => { res.resume(); });
req.on('error', () => {});
req.write(body);
req.end();
" 2>/dev/null || true

exit 0
