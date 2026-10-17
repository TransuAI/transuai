#!/bin/sh
# 本機（地端）的模型伺服器：用 Docker 跑 vLLM（用 GPU），三個 OpenAI 相容的服務——
#   聊天模型（平台模型：摘要、章節、問答、會後處理……）  http://localhost:8000/v1
#   embedding（問答找段落、決策的搜尋）                   http://localhost:8001/v1
#   語音辨識（/v1/audio/transcriptions，有片段時間）      http://localhost:8002/v1
#     transcription-service 之後改用它（現在還是 Deepgram），先一起起來、把顯示記憶體佔好。
# k8s 裡的 pod 經由 Docker Desktop 的 host.docker.internal 連到它們（01-configmap.yaml 的 PLATFORM_LLM_BASE_URL、
# EMBEDDING_BASE_URL）。模型權重第一次啟動時從 Hugging Face Hub 下載（只是下載，推論都在本機），存在 Docker volume，
# 之後不用再下載。見 ai-service/docs/adr/0015。
#
# 一張 16GB 的卡（RTX 5080）同時放三個：每個 vLLM 先佔好固定比例的顯示記憶體（--gpu-memory-utilization 是整張卡的比例），
# 加起來要留給 Windows 桌面（約 1.8GB）。預設值是 2026-10-17 在 RTX 5080 上實測的（三個都起來後用了 14.6／16.3GB），見
# ai-service ADR 0015；換別張卡或別的模型，用下面的環境變數調。
#
# 用法（./script.sh、bash script.sh、sh script.sh 都可以）：
#   ./infra/scripts/vllm.sh up       開起來（第一次會建容器、下載模型；聊天模型要幾分鐘）
#   ./infra/scripts/vllm.sh status   容器、各自用了多少顯示記憶體、服務的模型
#   ./infra/scripts/vllm.sh logs     兩個容器最近的 log
#   ./infra/scripts/vllm.sh down     停掉並移除容器（模型留在 volume 裡）
set -eu

IMAGE="${VLLM_IMAGE:-vllm/vllm-openai:v0.31.0}"
VOLUME=transuai-vllm-models

CHAT_CONTAINER=transuai-vllm-chat
CHAT_PORT="${VLLM_CHAT_PORT:-8000}"
# 要跟 01-configmap.yaml 的 PLATFORM_LLM_MODEL、AI_POST_MEETING_PLATFORM_MODEL 一致。
CHAT_MODEL="${VLLM_CHAT_MODEL:-Qwen/Qwen3-8B-AWQ}"
# 一小時的逐字稿約 2.5 萬 token。0.53 的顯示記憶體放得下 29184 個 token 的 KV cache（fp8），上下文就設 28672；
# 沒有語音辨識時可以給到 0.62／40960（Qwen3-8B 原生的上限）。
CHAT_MAX_LEN="${VLLM_CHAT_MAX_LEN:-28672}"
CHAT_GPU_SHARE="${VLLM_CHAT_GPU_SHARE:-0.53}"

EMBED_CONTAINER=transuai-vllm-embed
EMBED_PORT="${VLLM_EMBED_PORT:-8001}"
# 要跟 01-configmap.yaml 的 EMBEDDING_MODEL 一致；輸出要是 1024 維（資料庫的向量欄位）。
EMBED_MODEL="${VLLM_EMBED_MODEL:-Qwen/Qwen3-Embedding-0.6B}"
EMBED_MAX_LEN="${VLLM_EMBED_MAX_LEN:-2048}"
EMBED_GPU_SHARE="${VLLM_EMBED_GPU_SHARE:-0.12}"

STT_CONTAINER=transuai-vllm-stt
STT_PORT="${VLLM_STT_PORT:-8002}"
# 聯發科的 Breeze-ASR-25：Whisper-large-v2 針對台灣華語與中英夾雜調過（Apache-2.0）。權重用 fp8 載入（1.5GB），不錄 CUDA graph
# （錄了要多 4.8GB），一次一段；90 秒的錄音約 13 秒辨識完（第一次要暖機）。
STT_MODEL="${VLLM_STT_MODEL:-MediaTek-Research/Breeze-ASR-25}"
STT_GPU_SHARE="${VLLM_STT_GPU_SHARE:-0.16}"

run() {
    name=$1 port=$2
    shift 2
    if docker ps --format '{{.Names}}' | grep -qx "$name"; then
        echo "== $name 已經在跑 =="
        return
    fi
    docker rm -f "$name" >/dev/null 2>&1 || true
    echo "== 建立 $name（GPU、模型存在 volume $VOLUME）=="
    docker run -d --name "$name" --gpus all --restart unless-stopped --ipc=host \
        -p "$port:8000" -v "$VOLUME:/root/.cache/huggingface" \
        "$IMAGE" "$@" >/dev/null
}

wait_ready() {
    name=$1 port=$2
    echo "== 等 $name 準備好（第一次要下載模型）=="
    i=0
    until curl -sf "http://localhost:$port/v1/models" >/dev/null 2>&1; do
        i=$((i + 1))
        if ! docker ps --format '{{.Names}}' | grep -qx "$name"; then
            echo "$name 停掉了，看 docker logs $name" >&2
            exit 1
        fi
        if [ "$i" -ge 900 ]; then
            echo "$name 沒有在 15 分鐘內起來，看 docker logs $name" >&2
            exit 1
        fi
        sleep 1
    done
}

up() {
    # 小的先起來：每個 vLLM 啟動時都要看到它要的那份顯示記憶體是空的。
    run "$EMBED_CONTAINER" "$EMBED_PORT" \
        "$EMBED_MODEL" --runner pooling --convert embed \
        --max-model-len "$EMBED_MAX_LEN" --gpu-memory-utilization "$EMBED_GPU_SHARE"
    wait_ready "$EMBED_CONTAINER" "$EMBED_PORT"
    run "$STT_CONTAINER" "$STT_PORT" \
        "$STT_MODEL" --quantization fp8 --enforce-eager --gpu-memory-utilization "$STT_GPU_SHARE" \
        --max-num-seqs 1 --max-num-batched-tokens 1500 --limit-mm-per-prompt '{"audio": 1}'
    wait_ready "$STT_CONTAINER" "$STT_PORT"
    # 會後處理要呼叫工具：Qwen3 的工具呼叫格式是 hermes。thinking 由 ai-service 每次呼叫關掉（PLATFORM_LLM_EXTRA_BODY）。
    run "$CHAT_CONTAINER" "$CHAT_PORT" \
        "$CHAT_MODEL" --max-model-len "$CHAT_MAX_LEN" --kv-cache-dtype fp8 \
        --gpu-memory-utilization "$CHAT_GPU_SHARE" --max-num-seqs 4 \
        --enable-auto-tool-choice --tool-call-parser hermes
    wait_ready "$CHAT_CONTAINER" "$CHAT_PORT"
    status
}

status() {
    docker ps -a --filter "name=^transuai-vllm-" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
    echo
    nvidia-smi --query-gpu=name,memory.used,memory.total --format=csv 2>/dev/null || true
    for port in "$EMBED_PORT" "$STT_PORT" "$CHAT_PORT"; do
        models=$(curl -sf "http://localhost:$port/v1/models" 2>/dev/null | sed -n 's/.*"root":"\([^"]*\)".*/\1/p' || true)
        echo "localhost:$port  ${models:-（沒有回應）}"
    done
}

case "${1:-}" in
    up) up ;;
    status) status ;;
    logs)
        for name in "$EMBED_CONTAINER" "$STT_CONTAINER" "$CHAT_CONTAINER"; do
            echo "== $name =="
            docker logs --tail 30 "$name" 2>&1 || true
        done
        ;;
    down)
        docker rm -f "$CHAT_CONTAINER" "$STT_CONTAINER" "$EMBED_CONTAINER" >/dev/null 2>&1 || true
        echo "== 已停止並移除 vLLM 容器（模型留在 volume $VOLUME）=="
        ;;
    *)
        echo "用法：$0 up | status | logs | down" >&2
        exit 1
        ;;
esac
