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

echo "==> BASE_URL=${BASE_URL}  API_PREFIX=${API_PREFIX:-"(空)"}"
echo "==> 1) GET /rest-api/login（错误凭据应 401）"
code=$(curl -sS -o /tmp/rest_login_bad.json -w '%{http_code}' -G "$(api '/rest-api/login')" \
  --data-urlencode 'username=nobody' \
  --data-urlencode 'password=wrong' \
  -H 'Accept: application/json') || true
echo "    HTTP $code  body: $(cat /tmp/rest_login_bad.json)"
[[ "$code" == "401" ]] || echo "    （若非 401，请检查 BASE_URL / API_PREFIX）"

need_creds
echo "==> 2) GET /rest-api/login（正确凭据应 200 且含 token）"
code=$(curl -sS -o /tmp/rest_login_ok.json -w '%{http_code}' -G "$(api '/rest-api/login')" \
  --data-urlencode "username=${HYDRO_USER}" \
  --data-urlencode "password=${HYDRO_PASS}" \
  -H 'Accept: application/json') || true
echo "    HTTP $code"
[[ "$code" == "200" ]] || die "登录失败，响应: $(cat /tmp/rest_login_ok.json)"
TOKEN=$(json_get_token < /tmp/rest_login_ok.json)
[[ -n "$TOKEN" ]] || die "响应中无 token: $(cat /tmp/rest_login_ok.json)"
echo "    token 已获取（长度 ${#TOKEN}）"

AUTH=( -H "Authorization: Bearer ${TOKEN}" -H 'Accept: application/json' )

echo "==> 3) GET /rest-api/problems?page=1&pageSize=2"
curl -sS "${AUTH[@]}" -G "$(api '/rest-api/problems')" --data-urlencode 'page=1' --data-urlencode 'pageSize=2' | head -c 400
echo ""
echo "    …"

echo "==> 4) GET /rest-api/submissions?page=1&pageSize=2"
curl -sS "${AUTH[@]}" -G "$(api '/rest-api/submissions')" --data-urlencode 'page=1' --data-urlencode 'pageSize=2' | head -c 400
echo ""
echo "    …"

echo "==> 5) GET /rest-api/homework?page=1&pageSize=2（作业 / rule=homework）"
curl -sS "${AUTH[@]}" -G "$(api '/rest-api/homework')" --data-urlencode 'page=1' --data-urlencode 'pageSize=2' | head -c 400
echo ""
echo "    …"

echo "==> 6) GET /rest-api/contests?page=1&pageSize=2（正式比赛，不含 homework）"
curl -sS "${AUTH[@]}" -G "$(api '/rest-api/contests')" --data-urlencode 'page=1' --data-urlencode 'pageSize=2' | head -c 400
echo ""
echo "    …"

echo "==> 完成。若为 JSON 片段而非整页 HTML，addon 基本正常。"
echo "    若 404，可试: export API_PREFIX='/d/system'"
