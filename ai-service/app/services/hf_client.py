import re
from functools import lru_cache
from typing import Iterable, Iterator

from huggingface_hub import InferenceClient

from app.core.config import settings

_THINK_BLOCK = re.compile(r"<think>.*?</think>", re.DOTALL)
_THINK_OPEN = "<think>"
_THINK_CLOSE = "</think>"

# Qwen3 系列（含目前用的 Qwen/Qwen3.5-9B）預設會開 thinking mode：完整的思考過程另外算
# completion tokens（HF 回應把它放在 message.reasoning，不是混進 content 的 <think> 標籤，
# 這點跟 groq qwen3.6-27b 的行為不同，見 strip_thinking() 的說明），但沒設 max_tokens 上限
# 時 provider 預設只給 2048——對稍微長一點的輸入，光思考就能把預算燒光，content 直接是空的
# （finish_reason="length"），而且拉高 max_tokens 治標不治本：實測 531 段逐字稿的章節分段
# 呼叫，就算給到 32768 還是在思考階段被 HF gateway 504 timeout 打斷。這裡直接透過 chat
# template 的 enable_thinking 關掉 thinking mode，讓模型直接輸出答案——所有呼叫這個 client
# 做 chat completion 的地方都應該帶上這個。
DISABLE_THINKING = {"chat_template_kwargs": {"enable_thinking": False}}


@lru_cache(maxsize=1)
def get_client() -> InferenceClient:
    # 延遲到第一次真的呼叫才建立 client，避免 HF_API_KEY 還沒填時服務一啟動就噴錯，
    # 連 gRPC health check 都起不來。同一個 client 供 embedding（feature_extraction）
    # 跟 chat completion（摘要/章節分段/RAG 問答）共用，都是打同一個 HF Inference
    # Providers 帳號，沒有理由開兩個 client。沒指定 provider，讓 HF 自動挑當下有
    # live 的 provider（見 docs/adr/0003-hf-inference-providers-for-generation.md）。
    return InferenceClient(api_key=settings.hf_api_key)


def strip_thinking(text: str) -> str:
    """去掉輸出裡混進 content 的 <think>...</think> chain-of-thought，防禦性用途。

    目前用的 Qwen/Qwen3.5-9B 搭配 DISABLE_THINKING 之後，reasoning 是獨立欄位、不會混進
    content（這點跟原本 Groq qwen3.6-27b 的行為不同，那時候 content 裡真的會混著完整的
    <think> 區塊），所以正常情況下這裡是 no-op；保留是為了防之後換到其他模型/provider
    又變回混在一起的行為。
    """
    return _THINK_BLOCK.sub("", text).strip()


def stream_without_thinking(chunks: Iterable[str]) -> Iterator[str]:
    """streaming 版的 strip_thinking，一樣是防禦性用途（見 strip_thinking 的說明）。

    `<think>...</think>` 一定出現在回答最開頭，所以 buffer 到能判斷「這段是不是 think
    block 開頭」、以及（如果是）buffer 到看到 `</think>` 為止，之後就直接原樣往外吐，
    不用每個 delta 都重新掃過全部內容。chunks 是 chat completion streaming response
    已經拆好的文字片段（例如每個 delta.content）。
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
    # 整個回答比 `<think>` 還短時，串流結束前一直都還在判斷開頭，剩下的就是答案本身。
    if in_think is None and buffer:
        yield buffer
