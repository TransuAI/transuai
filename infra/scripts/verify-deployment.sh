#!/bin/sh
# 在客戶的環境驗收一次部署（infra/docs/deployment-checklist.md；ASVS 9.1、14.3.3、14.4、4.3.2、14.2.2）。從使用者會用的網路跑：
#
#   ./infra/scripts/verify-deployment.sh https://transuai.example.internal [內部的 host:port ...]
#
# 內部的 host:port（例如 gateway:8080 db.internal:5432）是「從這裡應該連不到」的位址，連得到就算沒通過。
# 每一項印 PASS／FAIL／SKIP，有 FAIL 時結束碼不是 0。需要 curl、openssl、nc。憑證是自簽的（例如驗收環境）時設 VERIFY_INSECURE=1；
# HTTP 不在 80 port 時用 VERIFY_HTTP_URL 指定（例如 http://host:8080）。
set -u

URL="${1:?用法：$0 https://<網址> [內部的 host:port ...]}"
shift
URL="${URL%/}"
FAILED=0
CURL="curl -s"
[ "${VERIFY_INSECURE:-}" = 1 ] && CURL="curl -s -k"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; FAILED=1; }
skip() { echo "SKIP  $1"; }
header() { grep -i "^$2:" "$1" | head -1 | cut -d: -f2- | tr -d '\r' | sed 's/^ *//'; }

$CURL -D "$WORK/page" -o "$WORK/page.body" "$URL/" || { echo "連不到 $URL"; exit 2; }
$CURL -D "$WORK/api" -o /dev/null "$URL/api/jobs"

case "$URL" in
https://*)
    host_port="${URL#https://}"; host_port="${host_port%%/*}"
    case "$host_port" in *:*) ;; *) host_port="$host_port:443" ;; esac
    host="${host_port%%:*}"
    for version in tls1 tls1_1; do
        if echo | openssl s_client -connect "$host_port" -servername "$host" "-$version" >/dev/null 2>&1; then
            fail "不接受 $version（9.1.3）"
        else
            pass "不接受 $version（9.1.3）"
        fi
    done
    if echo | openssl s_client -connect "$host_port" -servername "$host" -tls1_2 >/dev/null 2>&1; then
        pass "接受 TLS 1.2 以上（9.1.1）"
    else
        fail "接受 TLS 1.2 以上（9.1.1）"
    fi
    # 沒有前向保密、或不是 AEAD 的 cipher；@SECLEVEL=0 讓 OpenSSL 3 真的送出這些（不然客戶端自己就不支援，會誤判成通過）。
    if echo | openssl s_client -connect "$host_port" -servername "$host" -tls1_2 \
        -cipher 'AES128-SHA:AES256-SHA:DES-CBC3-SHA:ECDHE-RSA-AES128-SHA:@SECLEVEL=0' >/dev/null 2>&1; then
        fail "不接受弱的 cipher（9.1.2）"
    else
        pass "不接受弱的 cipher（9.1.2）"
    fi
    # HTTP 那一邊預設是同一台的 80 port；不是的話用 VERIFY_HTTP_URL 指定。
    http_code=$($CURL -o /dev/null -w '%{http_code} %{redirect_url}' "${VERIFY_HTTP_URL:-http://$host}/")
    case "$http_code" in
        30[1278]\ https://*) pass "HTTP 轉址到 HTTPS（9.1.1）" ;;
        000*) pass "HTTP 不開（9.1.1）" ;;
        *) fail "HTTP 轉址到 HTTPS（9.1.1）：$http_code" ;;
    esac
    ;;
*)
    skip "TLS（網址不是 https://；正式環境一定要 HTTPS）"
    ;;
esac

for file in page api; do
    what=$([ "$file" = page ] && echo "頁面" || echo "API")
    [ -n "$(header "$WORK/$file" Strict-Transport-Security)" ] && pass "$what 有 HSTS（14.4.5）" || fail "$what 有 HSTS（14.4.5）"
    [ "$(header "$WORK/$file" X-Content-Type-Options)" = nosniff ] && pass "$what 有 nosniff（14.4.4）" || fail "$what 有 nosniff（14.4.4）"
    [ -n "$(header "$WORK/$file" Referrer-Policy)" ] && pass "$what 有 Referrer-Policy（14.4.6）" || fail "$what 有 Referrer-Policy（14.4.6）"
    case "$(header "$WORK/$file" Content-Security-Policy)" in
        *"frame-ancestors 'none'"*) pass "$what 的 CSP 不讓別的網站嵌入（14.4.3、14.4.7）" ;;
        *) fail "$what 的 CSP 不讓別的網站嵌入（14.4.3、14.4.7）" ;;
    esac
    case "$(header "$WORK/$file" Server)" in
        *[0-9]*) fail "$what 的 Server 標頭不露版本（14.3.3）：$(header "$WORK/$file" Server)" ;;
        *) pass "$what 的 Server 標頭不露版本（14.3.3）" ;;
    esac
done
case "$(header "$WORK/page" Content-Security-Policy)" in
    *"script-src 'self'"*) case "$(header "$WORK/page" Content-Security-Policy)" in
        *"script-src 'self' 'unsafe"*) fail "頁面的 CSP 只准自己網站的 script（14.4.3）" ;;
        *) pass "頁面的 CSP 只准自己網站的 script（14.4.3）" ;;
    esac ;;
    *) fail "頁面的 CSP 只准自己網站的 script（14.4.3）" ;;
esac
[ "$(header "$WORK/api" Cache-Control)" = no-store ] && pass "API 不給快取（8.2.1）" || fail "API 不給快取（8.2.1）"

for path in /.git/config /.env /package.json /assets/; do
    $CURL -o "$WORK/probe" "$URL$path"
    if grep -q -E '^\[core\]|^[A-Z_]+=|"devDependencies"|Index of' "$WORK/probe"; then
        fail "不提供 $path（4.3.2、12.5.1）"
    else
        pass "不提供 $path（4.3.2、12.5.1）"
    fi
done
code=$($CURL -o /dev/null -w '%{http_code}' "$URL/api/v3/api-docs")
[ "$code" = 404 ] || [ "$code" = 401 ] && pass "API 文件不對外（14.2.2）" || fail "API 文件不對外（14.2.2）：$code"

for target in "$@"; do
    if nc -z -w 3 "${target%:*}" "${target##*:}" 2>/dev/null; then
        fail "連不到內部的 $target（4.1.2、4.3.1）"
    else
        pass "連不到內部的 $target（4.1.2、4.3.1）"
    fi
done

echo
[ "$FAILED" = 0 ] && echo "全部通過" || echo "有沒通過的項目"
exit "$FAILED"
