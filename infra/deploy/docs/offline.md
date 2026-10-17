# 不能連外的環境

TransuAI 本身完全不用連外：本地模型（聊天、embedding、語音辨識）在 vLLM 跑、講者分離的模型打包在 transcription-service 的
image 裡。要連外的只有選用的功能——問答「查網路」（Tavily）、Deepgram、Claude／OpenAI／Gemini／OpenRouter、連結 Google／Notion——
不設定就不會用到（查網路的開關不會出現）。

要準備的是 **image** 與 **模型權重**，在一台能連外、裝了 Docker 的機器上做好再帶進去。

## 1. image

在能連外的機器上（同一版的安裝目錄）：

```bash
./install.sh --images build --no-gpu --url https://transuai.corp.internal --yes   # 或 --images pull；這裡只是為了把 image 準備好
COMPOSE_PROFILES=gpu ./bundle.sh transuai-images.tar                              # 含 vLLM；不跑本地模型就不加 COMPOSE_PROFILES
```

`bundle.sh` 把 compose 用到的所有 image（服務、postgres、redis、rabbitmq、minio、nginx、vLLM）存成一個 tar（含 vLLM 約 20 GB）。
準備的機器只是用來產生 image，之後可以 `docker compose down -v` 清掉。

## 2. 模型權重（跑本地模型時）

在能連外的機器上用 vLLM 的 image 下載到一個目錄：

```bash
mkdir -p models
docker run --rm -v "$PWD/models:/root/.cache/huggingface" --entrypoint hf vllm/vllm-openai:v0.31.0 \
  download Qwen/Qwen3-8B-AWQ
# Qwen/Qwen3-Embedding-0.6B、MediaTek-Research/Breeze-ASR-25 也一樣
tar czf transuai-models.tar.gz -C models .
```

## 3. 在內部的伺服器上安裝

把安裝目錄、`transuai-images.tar`、`transuai-models.tar.gz` 帶進去：

```bash
./install.sh --images load:transuai-images.tar --gpu --url https://transuai.corp.internal
docker compose stop vllm-embed vllm-stt vllm-chat
docker run --rm -i -v transuai_vllm-models:/models pgvector/pgvector:pg16 tar xzf - -C /models < transuai-models.tar.gz
sed -i 's/^VLLM_OFFLINE=.*/VLLM_OFFLINE=1/' .env
docker compose up -d
```

`VLLM_OFFLINE=1` 讓 vLLM 只用 volume 裡的模型，不嘗試連 Hugging Face。
