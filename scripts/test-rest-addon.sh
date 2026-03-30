#!/usr/bin/env bash
# 在 Hydro 所在机器上测试 restful-api addon 是否可用。
#
# 用法:
#   export HYDRO_USER='你的用户名' HYDRO_PASS='你的密码'
#   export BASE_URL='http://127.0.0.1:2333'   # 按实际监听地址改
#   # 带域名前缀: export API_PREFIX='/d/system'
#   接口前缀为 /rest-api（勿用 /api，会与 Hydro 内置 /api/:op 冲突）
#   bash scripts/test-rest-addon.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:2333}"
API_PREFIX="${API_PREFIX:-}"
HYDRO_USER="${HYDRO_USER:-}"
HYDRO_PASS="${HYDRO_PASS:-}"

api() {
  printf '%s' "${BASE_URL%/}${API_PREFIX}$1"
}

die() {
  echo "错误: $*" >&2
  exit 1
}

need_creds() {
  [[ -n "$HYDRO_USER" && -n "$HYDRO_PASS" ]] || die "请设置环境变量 HYDRO_USER 与 HYDRO_PASS"
}

json_get_token() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token') or '')"
  elif command -v jq >/dev/null 2>&1; then
    jq -r '.token // empty'
  else
    die "需要 python3 或 jq 以解析登录返回的 JSON"
  fi
}

# 从列表 JSON 取 items[0].id，若无则输出空行
json_first_item_id() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "import sys,json; d=json.load(sys.stdin); print(((d.get('items') or [{}])[0] or {}).get('id') or '')"
  elif command -v jq >/dev/null 2>&1; then
    jq -r '(.items[0].id // empty)'
  else
    die "需要 python3 或 jq 以解析列表 JSON"
  fi
}

echo "==> BASE_URL=${BASE_URL}  API_PREFIX=${API_PREFIX:-"(空)"}"
echo "==> 1) POST /rest-api/login（错误凭据应 401）"
LOGIN_BAD_JSON=$(python3 -c "import json; print(json.dumps({'username':'nobody','password':'wrong'}))")
code=$(curl -sS -o /tmp/rest_login_bad.json -w '%{http_code}' -X POST "$(api '/rest-api/login')" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  --data "$LOGIN_BAD_JSON") || true
echo "    HTTP $code  body: $(cat /tmp/rest_login_bad.json)"
[[ "$code" == "401" ]] || echo "    （若非 401，请检查 BASE_URL / API_PREFIX）"

need_creds
echo "==> 2) POST /rest-api/login（正确凭据应 200 且含 token）"
LOGIN_OK_JSON=$(python3 -c "import json,os; print(json.dumps({'username': os.environ.get('HYDRO_USER',''), 'password': os.environ.get('HYDRO_PASS','')}))")
code=$(curl -sS -o /tmp/rest_login_ok.json -w '%{http_code}' -X POST "$(api '/rest-api/login')" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  --data "$LOGIN_OK_JSON") || true
echo "    HTTP $code"
[[ "$code" == "200" ]] || die "登录失败，响应: $(cat /tmp/rest_login_ok.json)"
TOKEN=$(json_get_token < /tmp/rest_login_ok.json)
[[ -n "$TOKEN" ]] || die "响应中无 token: $(cat /tmp/rest_login_ok.json)"
echo "    token 已获取（长度 ${#TOKEN}）"

AUTH=( -H "Authorization: Bearer ${TOKEN}" -H 'Accept: application/json' )

echo "==> 3) GET /rest-api/problems?page=1&pageSize=2"
curl -sS "${AUTH[@]}" -o /tmp/rest_problems.json -G "$(api '/rest-api/problems')" \
  --data-urlencode 'page=1' --data-urlencode 'pageSize=2'
head -c 400 /tmp/rest_problems.json
echo ""
echo "    …"

echo "==> 4) GET /rest-api/submissions?page=1&pageSize=2"
curl -sS "${AUTH[@]}" -o /tmp/rest_submissions.json -G "$(api '/rest-api/submissions')" \
  --data-urlencode 'page=1' --data-urlencode 'pageSize=2'
head -c 400 /tmp/rest_submissions.json
echo ""
echo "    …"

echo "==> 5) GET /rest-api/homework?page=1&pageSize=2（作业 / rule=homework）"
curl -sS "${AUTH[@]}" -G "$(api '/rest-api/homework')" --data-urlencode 'page=1' --data-urlencode 'pageSize=2' | head -c 400
echo ""
echo "    …"

echo "==> 6) GET /rest-api/contests?page=1&pageSize=2（正式比赛，不含 homework）"
curl -sS "${AUTH[@]}" -o /tmp/rest_contests.json -G "$(api '/rest-api/contests')" \
  --data-urlencode 'page=1' --data-urlencode 'pageSize=2'
head -c 400 /tmp/rest_contests.json
echo ""
echo "    …"

echo "==> 7) GET /rest-api/homework/:id 与 /problems（取作业列表首条 id，若无则跳过）"
curl -sS "${AUTH[@]}" -o /tmp/rest_homework.json -G "$(api '/rest-api/homework')" \
  --data-urlencode 'page=1' --data-urlencode 'pageSize=1'
HID=$(json_first_item_id < /tmp/rest_homework.json)
if [[ -n "$HID" ]]; then
  echo "    homework id=${HID}"
  curl -sS "${AUTH[@]}" "$(api "/rest-api/homework/${HID}")" | head -c 400
  echo ""
  echo "    …"
  curl -sS "${AUTH[@]}" "$(api "/rest-api/homework/${HID}/problems")" | head -c 400
  echo ""
  echo "    …"
else
  echo "    （无作业，跳过）"
fi

echo "==> 8) GET /rest-api/contests/:id 与 /problems（取比赛列表首条 id，若无则跳过）"
CID=$(json_first_item_id < /tmp/rest_contests.json)
if [[ -n "$CID" ]]; then
  echo "    contest id=${CID}"
  curl -sS "${AUTH[@]}" "$(api "/rest-api/contests/${CID}")" | head -c 400
  echo ""
  echo "    …"
  curl -sS "${AUTH[@]}" "$(api "/rest-api/contests/${CID}/problems")" | head -c 400
  echo ""
  echo "    …"
else
  echo "    （无正式比赛，跳过）"
fi

echo "==> 9) GET /rest-api/problems/:id（取题目列表首条 id，若无则跳过）"
PID=$(json_first_item_id < /tmp/rest_problems.json)
if [[ -n "$PID" ]]; then
  echo "    problem id=${PID}"
  curl -sS "${AUTH[@]}" "$(api "/rest-api/problems/${PID}")" | head -c 400
  echo ""
  echo "    …"
else
  echo "    （无题目，跳过）"
fi

echo "==> 10) GET /rest-api/submissions/:id（取提交列表首条 id，若无则跳过）"
SID=$(json_first_item_id < /tmp/rest_submissions.json)
if [[ -n "$SID" ]]; then
  echo "    submission id=${SID}"
  curl -sS "${AUTH[@]}" "$(api "/rest-api/submissions/${SID}")" | head -c 400
  echo ""
  echo "    …"
else
  echo "    （无提交记录，跳过）"
fi

echo "==> 完成。若为 JSON 片段而非整页 HTML，addon 基本正常。"
echo "    若 404，可试: export API_PREFIX='/d/system'"
