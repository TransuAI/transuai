# 不能連外的環境

TransuAI 本身不用連外：講者分離的模型打包在 transcription-service 的 image 裡，聊天、embedding、語音辨識呼叫單位內部的模型伺服器
（見 [models.md](models.md)）。要連外的只有選用的功能——外部的模型服務（Claude／OpenAI／Gemini／OpenRouter）、Deepgram、問答「查網路」
（Tavily）、連結 Google／Notion——不設定就不會用到（查網路的開關不會出現）。

要準備的是 **image**：在一台能連外、裝了 Docker 的機器上做好再帶進去。

## 1. 準備 image

在能連外的機器上（同一版的安裝目錄）：

```bash
./install.sh --images build --url https://transuai.corp.internal --yes   # 或 --images pull；這裡只是為了把 image 準備好
./bundle.sh transuai-images.tar
```

`bundle.sh` 把 compose 用到的所有 image（服務、postgres、redis、rabbitmq、minio、nginx）存成一個 tar。準備的機器只是用來產生 image，
之後可以 `docker compose down -v` 清掉。

## 2. 在內部的伺服器上安裝

把安裝目錄與 `transuai-images.tar` 帶進去：

```bash
./install.sh --images load:transuai-images.tar --url https://transuai.corp.internal
```

## 3. 模型伺服器

模型伺服器（例如 vLLM）也要在內部：在能連外的機器上把 vLLM 的 image（`docker save`）與模型權重準備好帶進 GPU 伺服器。下載權重：

```bash
mkdir -p models
docker run --rm -v "$PWD/models:/root/.cache/huggingface" --entrypoint hf vllm/vllm-openai:v0.31.0 \
  download Qwen/Qwen3-8B-AWQ
# Qwen/Qwen3-Embedding-0.6B、MediaTek-Research/Breeze-ASR-25 也一樣
tar czf transuai-models.tar.gz -C models .
```

在 GPU 伺服器上放進 `infra/scripts/vllm.sh` 用的 volume，並讓 vLLM 不要連 Hugging Face：

```bash
docker volume create transuai-vllm-models
docker run --rm -i -v transuai-vllm-models:/models alpine tar xzf - -C /models < transuai-models.tar.gz
```

`vllm.sh` 啟動的容器加上 `-e HF_HUB_OFFLINE=1`（或在 GPU 伺服器的 Docker 設定裡加），vLLM 就只用 volume 裡的模型。
