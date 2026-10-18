#!/usr/bin/env bash
# TransuAI 的安裝（一台有 Docker 的 Linux 伺服器）：產生 .env（隨機的密鑰與管理員密碼）與自簽憑證、取得 image、啟動、等到網頁可以開
#（有本地模型時也等模型下載、載入好），最後印出網址與管理員的帳號密碼。
# 再跑一次不會覆蓋已經有的 .env 與憑證（升級、重新啟動都可以再跑）。見 README.md。
#
#   ./install.sh                          問網址、要不要用本地模型，從原始碼 build image
#   ./install.sh --url https://transuai.corp.internal --gpu --images pull --yes
#
# 選項：
#   --url URL          使用者在瀏覽器打的網址（https://主機名或 IP[:port]）；預設 https://$(hostname -f)
#   --http-port N      轉址到 HTTPS 的 HTTP port；預設 80
#   --admin-email EMAIL  管理員的 email（登入用）；預設 admin@<主機名>
#   --gpu | --no-gpu   要不要一起跑本地模型（vLLM，要 NVIDIA GPU 與 NVIDIA Container Toolkit）；預設有 GPU 就問
#   --images MODE      build（從原始碼，預設）、pull（發行的 image，見 .env 的 TRANSUAI_REGISTRY／TRANSUAI_VERSION）、
#                      load:<檔案>（離線包，bundle.sh 產生的 tar）
#   --yes              不問，全部用預設值或上面的選項
set -euo pipefail

cd "$(dirname "$0")"

url="" http_port=80 admin_email="" gpu="" images="build" assume_yes=0
while [ $# -gt 0 ]; do
    case "$1" in
        --url) url="${2:?--url 要接網址}"; shift 2 ;;
        --http-port) http_port="${2:?--http-port 要接 port}"; shift 2 ;;
        --admin-email) admin_email="${2:?--admin-email 要接 email}"; shift 2 ;;
        --gpu) gpu=1; shift ;;
        --no-gpu) gpu=0; shift ;;
        --images) images="${2:?--images 要接 build、pull 或 load:<檔案>}"; shift 2 ;;
        --yes|-y) assume_yes=1; shift ;;
        -h|--help) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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

# ---------------------------------------------------------------- 4. 本地模型
if [ "$new_env" = 1 ]; then
    has_gpu=0
    if command -v nvidia-smi >/dev/null && nvidia-smi >/dev/null 2>&1; then
        gpu_name=$(nvidia-smi --query-gpu=name --format=csv,noheader | head -1)
        gpu_mib=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | head -1 | tr -d ' ')
        say "找到 NVIDIA GPU：$gpu_name（${gpu_mib} MiB）"
        if ! docker info 2>/dev/null | grep -qi nvidia; then
            echo "可是 Docker 還不能用 GPU：要先裝 NVIDIA Container Toolkit 並重啟 Docker"
            echo "（https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html），再跑一次 install.sh。"
            [ "$gpu" = 1 ] && die "--gpu 需要 NVIDIA Container Toolkit"
        elif [ "$gpu_mib" -lt 15500 ]; then
            # 預設的三個模型是在 16GB 的卡上實測的（docs/hardware.md），更小的卡放不下。
            echo "顯示記憶體不到 16GB，放不下預設的三個本地模型（見 docs/hardware.md）；模型改用外部的伺服器。"
            if [ "$gpu" = 1 ]; then echo "（--gpu：照樣啟動，請先調 .env 的 VLLM_*）"; has_gpu=1; fi
        else
            has_gpu=1
        fi
    fi
    if [ -z "$gpu" ]; then
        gpu=0
        if [ "$has_gpu" = 1 ]; then
            case "$(ask "一起裝本地模型（聊天、embedding、語音辨識；第一次要從 Hugging Face 下載約 10GB）？y/n" y)" in y|Y|yes) gpu=1 ;; esac
        fi
    elif [ "$gpu" = 1 ] && [ "$has_gpu" = 0 ]; then
        die "--gpu：這台沒有 Docker 能用的 NVIDIA GPU"
    fi
    if [ "$gpu" = 1 ]; then
        set_env COMPOSE_PROFILES gpu
        set_env PLATFORM_LLM_BASE_URL http://vllm-chat:8000/v1
        set_env PLATFORM_LLM_MODEL "$(env_value VLLM_CHAT_MODEL)"
        set_env AI_POST_MEETING_PLATFORM_MODEL "$(env_value VLLM_CHAT_MODEL)"
        set_env EMBEDDING_BASE_URL http://vllm-embed:8000/v1
        set_env EMBEDDING_MODEL "$(env_value VLLM_EMBED_MODEL)"
        set_env EMBEDDING_QUERY_INSTRUCTION "Given a question about a recording, retrieve the transcript passages that answer it"
        set_env STT_BASE_URL http://vllm-stt:8000/v1
        set_env STT_MODEL "$(env_value VLLM_STT_MODEL)"
        echo "本地模型會跟著啟動（.env 的 COMPOSE_PROFILES=gpu）"
    else
        echo "不跑本地模型：裝好之後在「系統設定」頁填模型伺服器與語音辨識"
    fi
fi

# ---------------------------------------------------------------- 5. image
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

# ---------------------------------------------------------------- 6. 啟動
say "啟動"
# 先起服務本身（不含本地模型）：模型第一次要下載很久，不讓它擋住網頁。
COMPOSE_PROFILES= docker compose up -d

say "等網頁可以開（${url}）"
for _ in $(seq 1 120); do
    if curl -ksf "https://127.0.0.1:${https_port}/api/system/status" >/dev/null 2>&1; then
        ready=1; break
    fi
    sleep 5
done
[ "${ready:-0}" = 1 ] || die "10 分鐘內沒有起來；看 docker compose ps 與 docker compose logs"

# ---------------------------------------------------------------- 7. 本地模型
# 一個一個起：每個 vLLM 啟動時要看到它那份顯示記憶體是空的（同時起會算錯 KV cache 而失敗）。第一次要從 Hugging Face 下載。
wait_healthy() {  # wait_healthy <service> <分鐘>
    local service=$1 minutes=$2 id state i
    for i in $(seq 1 $((minutes * 4))); do
        id=$(docker compose ps -q "$service" 2>/dev/null)
        state=$([ -n "$id" ] && docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null)
        [ "$state" = healthy ] && return 0
        if [ $((i % 8)) = 0 ]; then
            echo "  $(date +%H:%M) $service：${state:-還沒啟動}（$(docker compose logs --tail 1 --no-log-prefix "$service" 2>/dev/null | cut -c1-100)）"
        fi
        sleep 15
    done
    return 1
}
if grep -q '^COMPOSE_PROFILES=gpu' .env; then
    say "啟動本地模型（第一次要下載約 10GB，幾分鐘到幾十分鐘；網頁已經可以先用）"
    models_ready=1
    for service in vllm-embed vllm-stt vllm-chat; do
        docker compose up -d --no-deps "$service" >/dev/null 2>&1
        if wait_healthy "$service" 60; then
            echo "$service 好了"
        else
            echo "$service 60 分鐘內沒有好；看 docker compose logs $service（還在下載的話晚一點再跑一次 install.sh）"
            models_ready=0
            break
        fi
    done
    [ "$models_ready" = 1 ] && echo "本地模型都好了"
fi

# ---------------------------------------------------------------- 8. 完成
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
if grep -q '^COMPOSE_PROFILES=gpu' .env; then
    echo "  1. 用管理員登入。本地模型已經設定好；到「系統設定」按「檢查」確認，要寄信（SMTP）的話也在那裡填。"
else
    echo "  1. 用管理員登入，到「系統設定」填模型伺服器、語音辨識與寄信（SMTP），按「檢查」確認連得上。"
fi
cat <<EOF
  2. 其他人自己到網頁註冊（一般使用者）；要多一位管理員見 README.md。
  3. 憑證是自簽的，瀏覽器會先警告；換成單位自己的憑證見 docs/tls.md。
  4. 備份：.env 與資料（docs/backup.md）。升級：docs/upgrade.md。
EOF
