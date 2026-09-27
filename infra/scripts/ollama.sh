#!/bin/sh
# 本機的平台模型伺服器：用 Docker 跑 Ollama（用 GPU），讓 ai-service 的摘要、章節、問答、會後處理跑在自己的顯示卡上，
# 不用付 AI API 的錢（見 ai-service/docs/adr/0010）。k8s 裡的 pod 經由 Docker Desktop 的 host.docker.internal 連到它，
# 01-configmap.yaml 的 PLATFORM_LLM_BASE_URL 指向 http://host.docker.internal:11434/v1。
#
# 用法（./script.sh、bash script.sh、sh script.sh 都可以）：
#   ./infra/scripts/ollama.sh up       開起來（第一次會建容器），並下載設定用到的模型
#   ./infra/scripts/ollama.sh pull     只下載模型
#   ./infra/scripts/ollama.sh status   容器、已下載的模型、目前載入 GPU 的模型
#   ./infra/scripts/ollama.sh down     停掉容器（模型留在 volume 裡，下次 up 不用重新下載）
set -eu

CONTAINER=transuai-ollama
VOLUME=transuai-ollama-models
PORT=11434
# 一般生成（摘要、章節、問答）與會後處理用的模型；要跟 01-configmap.yaml 的 AI_HF_CHAT_MODEL、
# AI_POST_MEETING_PLATFORM_MODEL 一致。
MODELS="qwen3.5:9b qwen3:14b"

up() {
    if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
        echo "== $CONTAINER 已經在跑 =="
    elif docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
        echo "== 啟動 $CONTAINER =="
        docker start "$CONTAINER" >/dev/null
    else
        echo "== 建立 $CONTAINER（GPU、模型存在 volume $VOLUME）=="
        # 上下文長度：1 小時的逐字稿約 2.5 萬 token，會後處理一次最多約 5 萬；Ollama 預設很短，要設大。
        # KV cache 用 q8_0（要開 flash attention）省一半顯示記憶體，16GB 才放得下模型加長上下文。
        docker run -d --name "$CONTAINER" --gpus all --restart unless-stopped \
            -p "$PORT:11434" -v "$VOLUME:/root/.ollama" \
            -e OLLAMA_CONTEXT_LENGTH=32768 \
            -e OLLAMA_FLASH_ATTENTION=1 \
            -e OLLAMA_KV_CACHE_TYPE=q8_0 \
            -e OLLAMA_KEEP_ALIVE=30m \
            ollama/ollama >/dev/null
    fi
    wait_ready
    pull
}

wait_ready() {
    i=0
    until curl -s "http://localhost:$PORT/api/version" >/dev/null 2>&1; do
        i=$((i + 1))
        if [ "$i" -ge 60 ]; then
            echo "Ollama 沒有在 60 秒內起來，看 docker logs $CONTAINER" >&2
            exit 1
        fi
        sleep 1
    done
}

pull() {
    for model in $MODELS; do
        echo "== 下載 $model（已經有的話很快）=="
        docker exec "$CONTAINER" ollama pull "$model"
    done
}

status() {
    docker ps -a --filter "name=^$CONTAINER\$" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
    if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
        echo
        echo "== 已下載的模型 =="
        docker exec "$CONTAINER" ollama list
        echo
        echo "== 目前載入 GPU 的模型 =="
        docker exec "$CONTAINER" ollama ps
    fi
}

case "${1:-}" in
    up) up ;;
    pull) wait_ready; pull ;;
    status) status ;;
    down) docker stop "$CONTAINER" >/dev/null && echo "== 已停止 $CONTAINER ==" ;;
    *)
        echo "用法：$0 up | pull | status | down" >&2
        exit 1
        ;;
esac
