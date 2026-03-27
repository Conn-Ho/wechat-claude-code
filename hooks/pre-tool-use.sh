#!/usr/bin/env bash
# wechat-claude-code PreToolUse hook
#
# 只在 wcc 审批模式开启时才拦截工具调用。
# 开关文件：~/.claude/channels/wechat/approval-mode
# 开启：touch ~/.claude/channels/wechat/approval-mode
# 关闭：rm ~/.claude/channels/wechat/approval-mode

APPROVAL_FLAG="$HOME/.claude/channels/wechat/approval-mode"

# 未开启审批模式 → 直接放行
if [ ! -f "$APPROVAL_FLAG" ]; then
  exit 0
fi

# 读取 stdin（Claude Code 传入的 JSON）
INPUT=$(cat)

# 生成唯一 ID
ID=$(node -e "process.stdout.write(require('crypto').randomBytes(8).toString('hex'))" 2>/dev/null \
  || python3 -c "import secrets; print(secrets.token_hex(8),end='')" 2>/dev/null \
  || echo "$(date +%s)$$")

PENDING_FILE="/tmp/wcc-approval-${ID}.pending"
RESULT_FILE="/tmp/wcc-approval-${ID}.result"

# 写入待审批文件
(node -e "
const data = JSON.parse(process.env.INPUT || '{}');
data.id = '${ID}';
require('fs').writeFileSync('${PENDING_FILE}', JSON.stringify(data));
" INPUT="$INPUT" 2>/dev/null) || \
(python3 -c "
import json,os,sys
data = json.loads(os.environ.get('INPUT','{}'))
data['id'] = '${ID}'
open('${PENDING_FILE}','w').write(json.dumps(data))
" INPUT="$INPUT" 2>/dev/null) || \
echo "{\"id\":\"${ID}\",\"raw\":1}" > "$PENDING_FILE"

# 等待审批结果（超时 2 分钟）
for i in $(seq 1 120); do
  if [ -f "$RESULT_FILE" ]; then
    DECISION=$(node -e "try{process.stdout.write(JSON.parse(require('fs').readFileSync('${RESULT_FILE}','utf8')).decision||'deny')}catch(e){process.stdout.write('deny')}" 2>/dev/null \
      || python3 -c "import json; print(json.load(open('${RESULT_FILE}')).get('decision','deny'),end='')" 2>/dev/null \
      || echo "deny")
    rm -f "$PENDING_FILE" "$RESULT_FILE"
    if [ "$DECISION" = "allow" ]; then
      exit 0
    else
      echo "操作已通过微信被拒绝" >&2
      exit 2
    fi
  fi
  sleep 1
done

# 超时 → 放行（避免永久卡死）
rm -f "$PENDING_FILE"
echo "审批超时，已自动放行" >&2
exit 0
