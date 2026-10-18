#!/usr/bin/env bash
# TransuAI 的安裝（一台有 Docker 的 Linux 伺服器）：產生 .env（隨機的密鑰與管理員密碼）與自簽憑證、取得 image、啟動、等到網頁可以開，
# 最後印出網址與管理員的帳號密碼。模型伺服器不在這裡裝（另外部署，在「系統設定」頁填；見 docs/models.md）。
# 再跑一次不會覆蓋已經有的 .env 與憑證（升級、重新啟動都可以再跑）。見 README.md。
#
#   ./install.sh                          問網址與管理員的 email，從原始碼 build image
#   ./install.sh --url https://transuai.corp.internal --admin-email it@corp.internal --images pull --yes
#
# 選項：
#   --url URL          使用者在瀏覽器打的網址（https://主機名或 IP[:port]）；預設 https://$(hostname -f)
#   --http-port N      轉址到 HTTPS 的 HTTP port；預設 80
#   --admin-email EMAIL  管理員的 email（登入用）；預設 admin@<主機名>
#   --images MODE      build（從原始碼，預設）、pull（發行的 image，見 .env 的 TRANSUAI_REGISTRY／TRANSUAI_VERSION）、
#                      load:<檔案>（離線包，bundle.sh 產生的 tar）
#   --yes              不問，全部用預設值或上面的選項
set -euo pipefail

cd "$(dirname "$0")"

url="" http_port=80 admin_email="" images="build" assume_yes=0
while [ $# -gt 0 ]; do
    case "$1" in
        --url) url="${2:?--url 要接網址}"; shift 2 ;;
        --http-port) http_port="${2:?--http-port 要接 port}"; shift 2 ;;
        --admin-email) admin_email="${2:?--admin-email 要接 email}"; shift 2 ;;
        --images) images="${2:?--images 要接 build、pull 或 load:<檔案>}"; shift 2 ;;
        --yes|-y) assume_yes=1; shift ;;
        -h|--help) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "不認得的選項：$1（--help 看用法）" >&2; exit 2 ;;
    esac
done

say() { printf '\n== %s\n' "$*"; }
die() { printf '\n安裝停下來了：%s\n' "$*" >&2; exit 1; }
ask() {  # ask <問題> <預設值> → 回答（--yes 時直接用預設值）
    local answer
    if [ "$assume_yes" = 1 ] || [ ! -t 0 ]; then echo "$2"; return; fi
    read -r -p "$1 [$2] " answer
    echo "${answer:-$2}"
}

# ---------------------------------------------------------------- 1. 需要的工具
say "檢查 Docker"
command -v docker >/dev/null || die "找不到 docker：先裝 Docker Engine（https://docs.docker.com/engine/install/）"
docker info >/dev/null 2>&1 || die "連不上 Docker（docker 服務有在跑嗎？這個使用者在 docker 群組裡嗎？）"
compose_version=$(docker compose version --short 2>/dev/null) || die "找不到 docker compose（Compose v2 外掛）"
# compose.yaml 用到 configs.content（2.23 開始有）。
if [ "$(printf '%s\n' 2.23.0 "${compose_version#v}" | sort -V | head -1)" != 2.23.0 ]; then
    die "Docker Compose 要 2.23 以上（現在是 $compose_version）"
fi
command -v openssl >/dev/null || die "找不到 openssl（產生密鑰與憑證用）"
command -v curl >/dev/null || die "找不到 curl（檢查網頁有沒有起來用）"

# ---------------------------------------------------------------- 2. .env
new_env=0
if [ -f .env ]; then
    say "已經有 .env，沿用（不改密鑰與網址）"
else
    say "產生 .env"
    new_env=1
    [ -n "$url" ] || url=$(ask "使用者在瀏覽器打的網址（https://主機名或 IP[:port]）" "https://$(hostname -f 2>/dev/null || hostname)")
    url="${url%/}"
    case "$url" in https://*) ;; *) die "網址要用 https://（登入用的 cookie 只能在 HTTPS 上）：$url" ;; esac
    hostport="${url#https://}"
    case "$hostport" in */*) die "網址只要主機與 port，不要路徑：$url" ;; esac
    host="${hostport%%:*}"
    https_port=443
    [ "$hostport" != "$host" ] && https_port="${hostport#*:}"

    if [ -z "$admin_email" ]; then
        # 主機名有網域時用它；IP 或沒有網域時用 transuai.local（只是登入用的名字，設定寄信之前不會寄信過去）。
        if [[ "$host" == *.* && ! "$host" =~ ^[0-9.]+$ ]]; then default_email="admin@$host"; else default_email="admin@transuai.local"; fi
        admin_email=$(ask "管理員的 email（登入用）" "$default_email")
    fi
    case "$admin_email" in *@*) ;; *) die "管理員的 email 不對：$admin_email" ;; esac
    # 管理員的初始密碼：auth-service 第一次啟動時用它建立管理員，第一次登入就要換掉（之後這個值就沒用了）。
    admin_password="$(openssl rand -hex 2)-$(openssl rand -hex 2)-$(openssl rand -hex 2)-$(openssl rand -hex 2)-$(openssl rand -hex 2)"

    secret() { openssl rand -hex 24; }  # 48 個十六進位字元：夠長、放進網址與指令都不用跳脫
    tmp=$(mktemp .env.XXXXXX)
    trap 'rm -f "$tmp"' EXIT
    while IFS= read -r line; do
        case "$line" in
            TRANSUAI_URL=*) line="TRANSUAI_URL=$url" ;;
            TRANSUAI_HTTPS_PORT=*) line="TRANSUAI_HTTPS_PORT=$https_port" ;;
            TRANSUAI_HTTP_PORT=*) line="TRANSUAI_HTTP_PORT=$http_port" ;;
            FRONTEND_URL=*) line="FRONTEND_URL=$url" ;;
            OAUTH_CALLBACK_BASE_URL=*) line="OAUTH_CALLBACK_BASE_URL=$url/api" ;;
            STORAGE_PUBLIC_ENDPOINT=*) line="STORAGE_PUBLIC_ENDPOINT=$url" ;;
            JWT_SECRET=*) line="JWT_SECRET=$(openssl rand -hex 32)" ;;
            KEY_ENCRYPTION_KEY=*) line="KEY_ENCRYPTION_KEY=$(openssl rand -base64 32)" ;;
            INITIAL_ADMIN_EMAIL=*) line="INITIAL_ADMIN_EMAIL=$admin_email" ;;
            INITIAL_ADMIN_PASSWORD=*) line="INITIAL_ADMIN_PASSWORD=$admin_password" ;;
            *=\<generate\>) line="${line%%=*}=$(secret)" ;;
        esac
        printf '%s\n' "$line"
    done < .env.example > "$tmp"
    chmod 600 "$tmp"
    mv "$tmp" .env
    trap - EXIT
    echo "已寫入 .env（只有你讀得到；裡面的 KEY_ENCRYPTION_KEY 要跟資料庫一起備份）"
fi

env_value() { sed -n "s/^$1=//p" .env | tail -1; }
set_env() {  # set_env KEY VALUE：改 .env 裡的一行（沒有就加在最後）
    if grep -q "^$1=" .env; then
        local escaped; escaped=$(printf '%s' "$2" | sed 's/[&|\\]/\\&/g')
        sed -i "s|^$1=.*|$1=$escaped|" .env
    else
        printf '%s=%s\n' "$1" "$2" >> .env
    fi
}
url=$(env_value TRANSUAI_URL)
https_port=$(env_value TRANSUAI_HTTPS_PORT)

# ---------------------------------------------------------------- 3. 憑證
if [ -f tls/tls.crt ] && [ -f tls/tls.key ]; then
    say "已經有憑證（tls/tls.crt），沿用"
else
    say "產生自簽憑證（之後換成單位自己的，見 docs/tls.md）"
    host="${url#https://}"; host="${host%%:*}"
    if [[ "$host" =~ ^[0-9]+(\.[0-9]+){3}$ ]]; then san="IP:$host"; else san="DNS:$host"; fi
    mkdir -p tls
    openssl req -x509 -newkey rsa:3072 -sha256 -days 825 -nodes \
        -keyout tls/tls.key -out tls/tls.crt -subj "/CN=$host" \
        -addext "subjectAltName=$san,DNS:localhost,IP:127.0.0.1" \
        -addext "extendedKeyUsage=serverAuth" 2>/dev/null
    # edge 的 nginx 不是用 root 跑，要讀得到私鑰。
    chmod 644 tls/tls.crt tls/tls.key
fi

# ---------------------------------------------------------------- 4. image
case "$images" in
    build)
        say "從原始碼 build image（第一次要十幾分鐘）"
        [ -f ../../auth-service/Dockerfile ] || die "這裡不是完整的原始碼（找不到 ../../auth-service）；用 --images pull 或 load:<檔案>"
        docker compose -f compose.yaml -f compose.build.yaml build
        ;;
    pull)
        say "下載 image（$(env_value TRANSUAI_REGISTRY)、$(env_value TRANSUAI_VERSION)）"
        docker compose pull --ignore-buildable
        ;;
    load:*)
        bundle="${images#load:}"
        [ -f "$bundle" ] || die "找不到離線包：$bundle"
        say "從離線包載入 image：$bundle"
        docker load -i "$bundle"
        ;;
    *) die "--images 要是 build、pull 或 load:<檔案>：$images" ;;
esac

# ---------------------------------------------------------------- 5. 啟動
say "啟動"
docker compose up -d

say "等網頁可以開（${url}）"
for _ in $(seq 1 120); do
    if curl -ksf "https://127.0.0.1:${https_port}/api/system/status" >/dev/null 2>&1; then
        ready=1; break
    fi
    sleep 5
done
[ "${ready:-0}" = 1 ] || die "10 分鐘內沒有起來；看 docker compose ps 與 docker compose logs"

# ---------------------------------------------------------------- 6. 完成
admin_email=$(env_value INITIAL_ADMIN_EMAIL)
admin_password=$(env_value INITIAL_ADMIN_PASSWORD)
# 管理員還沒換掉初始密碼時才印出來（換過之後它就沒用了）。
must_change=""
if [ -n "$admin_email" ]; then
    # email 當成 psql 的變數傳進去（:'email' 會加引號），不直接拼進 SQL。
    must_change=$(printf "select must_change_password from users where email = :'email';\n" | docker compose exec -T postgres \
        sh -c 'psql -U "$POSTGRES_USER" -d auth_db -tA -v email="$1"' sh "$admin_email" 2>/dev/null || true)
fi

echo
echo "TransuAI 裝好了：$url"
echo
if [ "$must_change" = t ]; then
    cat <<EOF
  管理員帳號：$admin_email
  初始密碼：  $admin_password
  （第一次登入時要換成你自己的密碼；這組密碼也記在 .env 的 INITIAL_ADMIN_PASSWORD，換過之後就沒用了）

EOF
fi
echo "  1. 用管理員登入，到「系統設定」填模型伺服器（聊天、embedding）、語音辨識與寄信（SMTP），按「檢查」確認連得上。"
echo "     模型伺服器另外部署（例如另一台 GPU 伺服器上的 vLLM），見 docs/models.md。"
cat <<EOF
  2. 其他人自己到網頁註冊（一般使用者）；要多一位管理員見 README.md。
  3. 憑證是自簽的，瀏覽器會先警告；換成單位自己的憑證見 docs/tls.md。
  4. 備份：.env 與資料（docs/backup.md）。升級：docs/upgrade.md。
EOF
