#!/bin/sh
# 把一個已經註冊的帳號設成管理員（能改系統設定）。全新安裝不用：第一個註冊的帳號自動是管理員；這支給「升級前就有使用者」或
# 「要多一位管理員」用。改的是 auth_db 的 users.role，馬上生效（不用重新登入）。
#
# 用法（./script.sh、bash script.sh、sh script.sh 都可以）：
#   ./infra/scripts/make-admin.sh someone@example.com
set -eu
cd "$(dirname "$0")"
. ./_env.sh

if [ "$#" -ne 1 ]; then
    echo "用法：$0 <email>" >&2
    exit 1
fi
# email 一律小寫存（跟註冊一樣）；只接受看起來像 email 的字串，避免拼進 SQL 的東西有引號。
email=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')
case "$email" in
    *\'*|*\"*|*\\*|*" "*) echo "不像 email：$1" >&2; exit 1 ;;
    *@*) ;;
    *) echo "不像 email：$1" >&2; exit 1 ;;
esac

ensure_context
updated=$(kubectl -n "$NAMESPACE" exec postgres-0 -- sh -c \
    "psql -U \"\$POSTGRES_USER\" -d auth_db -qAt -c \"UPDATE users SET role = 'admin' WHERE email = '$email' RETURNING email\"")
if [ -z "$updated" ]; then
    echo "找不到這個帳號：$email（要先註冊）" >&2
    exit 1
fi
echo "== $updated 現在是管理員 =="
