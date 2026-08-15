import re
from functools import lru_cache
from typing import Iterable, Iterator

from huggingface_hub import InferenceClient

from app.core.config import settings

_THINK_BLOCK = re.compile(r"<think>.*?</think>", re.DOTALL)
_THINK_OPEN = "<think>"
_THINK_CLOSE = "</think>"


@lru_cache(maxsize=1)
def get_client() -> InferenceClient:
    # 延遲到第一次真的呼叫才建立 client，避免 HF_API_KEY 還沒填時服務一啟動就噴錯，
    # 連 gRPC health check 都起不來。同一個 client 供 embedding（feature_extraction）
    # 跟 chat completion（摘要/章節分段/RAG 問答）共用，都是打同一個 HF Inference
    # Providers 帳號，沒有理由開兩個 client。沒指定 provider，讓 HF 自動挑當下有
    # live 的 provider（見 docs/adr/0003-hf-inference-providers-for-generation.md）。
    return InferenceClient(api_key=settings.hf_api_key)


def strip_thinking(text: str) -> str:
    """去掉 reasoning model（Qwen3 系列預設可能開啟 thinking mode）輸出裡的
    <think>...</think> chain-of-thought。HF Inference Providers 的 chat completion
    介面沒有像 Groq 的 reasoning_format 這種請求參數可以要求隱藏，只能自己在這裡濾掉。
    """
    return _THINK_BLOCK.sub("", text).strip()


def stream_without_thinking(chunks: Iterable[str]) -> Iterator[str]:
    """streaming 版的 strip_thinking：`<think>...</think>` 一定出現在回答最開頭，所以
    buffer 到能判斷「這段是不是 think block 開頭」、以及（如果是）buffer 到看到
    `</think>` 為止，之後就直接原樣往外吐，不用每個 delta 都重新掃過全部內容。

    chunks 是 chat completion streaming response 已經拆好的文字片段（例如每個
    delta.content）。
    """
    buffer = ""
    in_think: bool | None = None  # None = 還沒判斷開頭；True/False = 已經判斷
    for delta in chunks:
        if not delta:
            continue
        if in_think is False:
            yield delta
            continue

        buffer += delta
        if in_think is None:
            if len(buffer) < len(_THINK_OPEN):
                continue
            if not buffer.startswith(_THINK_OPEN):
                in_think = False
                yield buffer
                buffer = ""
                continue
            in_think = True

        close_idx = buffer.find(_THINK_CLOSE)
        if close_idx == -1:
            continue
        remainder = buffer[close_idx + len(_THINK_CLOSE):]
        in_think = False
        buffer = ""
        if remainder:
            yield remainder
