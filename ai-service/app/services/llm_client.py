"""生成類 AI 呼叫（摘要、章節、問答、問題改寫）：所有廠商都走同一套 OpenAI 相容介面，一個 client、依廠商換
網址與金鑰。平台模型走 HF Inference Providers 的 OpenAI 相容路由；embedding 不在這裡（見 hf_client.py）。

回傳文字的同時回傳廠商回報的 token 用量（沒回報就是未知，不估算）。錯誤一律轉成 LlmError，標明廠商與原因，
暫時性錯誤（429、5xx、逾時、連不上）交給既有的訊息層級重試（見 retry.py 與 docs/adr/0001），client 自己不重試。
"""

import json
import re
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Iterable, Iterator, Protocol

import httpx2
import openai
from openai import OpenAI

from app.core import outbound
from app.core.config import settings

PLATFORM = "platform"

_THINK_BLOCK = re.compile(r"<think>.*?</think>", re.DOTALL)
_THINK_OPEN = "<think>"
_THINK_CLOSE = "</think>"

# Qwen3 系列（含目前用的 Qwen/Qwen3.5-9B）預設會開 thinking mode：完整的思考過程另外算
# completion tokens（HF 回應把它放在 message.reasoning，不是混進 content 的 <think> 標籤，
# 這點跟 groq qwen3.6-27b 的行為不同，見 strip_thinking() 的說明），但沒設 max_tokens 上限
# 時 provider 預設只給 2048——對稍微長一點的輸入，光思考就能把預算燒光，content 直接是空的
# （finish_reason="length"），而且拉高 max_tokens 治標不治本：實測 531 段逐字稿的章節分段
# 呼叫，就算給到 32768 還是在思考階段被 HF gateway 504 timeout 打斷。這裡直接透過 chat
# template 的 enable_thinking 關掉 thinking mode，讓模型直接輸出答案——平台模型的每次呼叫都帶上
# 這個（見 platform_chat_model()）。HF 的 OpenAI 相容路由會把它原樣轉給模型（2026-09-26 實測）。每種伺服器關 thinking
# 的寫法不同，所以要帶的參數是設定（PLATFORM_LLM_EXTRA_BODY）：Ollama 不吃 chat_template_kwargs，照樣先思考、把 token
# 燒光（2026-09-28 實測，qwen3.5:9b 回覆是空的），要改帶 {"reasoning_effort": "none"}。


@dataclass(frozen=True)
class ChatModel:
    """要呼叫的模型：哪個廠商、哪個模型、打哪個網址、用哪把金鑰。"""

    provider: str  # PLATFORM，或廠商名稱
    model: str
    base_url: str
    api_key: str
    extra_body: dict[str, Any] | None = None


def platform_chat_model(model: str | None = None) -> ChatModel:
    """平台模型：設定的 OpenAI 相容伺服器（PLATFORM_LLM_BASE_URL，預設是 HF Inference Providers）上的聊天模型，關閉 thinking
    mode。model 是某個用途專屬的平台模型（例如會後處理的），沒給就是一般生成（摘要、章節、問答）用的。"""
    return ChatModel(
        provider=PLATFORM,
        model=model or settings.ai_hf_chat_model,
        base_url=settings.platform_llm_base_url,
        api_key=settings.platform_llm_api_key or settings.hf_api_key,
        extra_body=json.loads(settings.platform_llm_extra_body) if settings.platform_llm_extra_body else None,
    )


@dataclass(frozen=True)
class TokenUsage:
    input_tokens: int | None  # None＝廠商沒回報
    output_tokens: int | None


UNKNOWN_USAGE = TokenUsage(None, None)


@dataclass(frozen=True)
class ChatResult:
    text: str
    usage: TokenUsage


class UsageSink(Protocol):
    """每次呼叫結束時收到用量（成功或失敗都會收到一次），見 usage_meter.UsageMeter。"""

    def record(self, model: ChatModel, usage: TokenUsage, succeeded: bool) -> None: ...


class LlmErrorReason(StrEnum):
    TRANSIENT = "transient"  # 429、5xx、逾時、連不上：值得重試
    AUTH = "auth"  # 金鑰無效或沒有權限
    QUOTA = "quota"  # 額度或餘額用完
    MODEL_NOT_FOUND = "model_not_found"
    MALFORMED_TOOL_CALL = "malformed_tool_call"  # 模型產生的工具參數不是合法 JSON（Groq 整輪拒絕）；再問一次通常就好
    OTHER = "other"  # 其他永久性錯誤（例如請求格式不被接受）


_REASON_TEXT = {
    LlmErrorReason.TRANSIENT: "暫時無法使用",
    LlmErrorReason.AUTH: "金鑰無效或沒有權限",
    LlmErrorReason.QUOTA: "額度不足",
    LlmErrorReason.MODEL_NOT_FOUND: "找不到這個模型",
    LlmErrorReason.MALFORMED_TOOL_CALL: "產生了格式不正確的工具呼叫",
    LlmErrorReason.OTHER: "拒絕了這個請求",
}


class LlmError(Exception):
    """一次生成類呼叫失敗；訊息點出是哪個廠商、哪個模型、什麼原因，會直接成為 Job 的錯誤原因。"""

    def __init__(self, provider: str, model: str, reason: LlmErrorReason, detail: str):
        who = "平台模型" if provider == PLATFORM else provider
        super().__init__(f"{who}（{model}）{_REASON_TEXT[reason]}：{detail}")
        self.provider = provider
        self.model = model
        self.reason = reason

    @property
    def transient(self) -> bool:
        return self.reason == LlmErrorReason.TRANSIENT


# openai SDK 底層用 httpx2。讀取逾時放寬（長逐字稿的摘要要一點時間）；連不上則很快放棄，交給訊息層級重試。
# 測試會換掉它（見 tests/conftest.py 的假 AI 廠商）。
_http_client = outbound.client(timeout=httpx2.Timeout(300.0, connect=10.0))


def _client(model: ChatModel) -> OpenAI:
    return OpenAI(base_url=model.base_url, api_key=model.api_key, http_client=_http_client, max_retries=0)


def _usage(usage: Any) -> TokenUsage:
    if usage is None:
        return UNKNOWN_USAGE
    return TokenUsage(input_tokens=usage.prompt_tokens, output_tokens=usage.completion_tokens)


_MAX_DETAIL_CHARS = 300


def _classify(exc: openai.APIError) -> tuple[LlmErrorReason, str]:
    if isinstance(exc, openai.APIConnectionError):  # 也涵蓋逾時
        return LlmErrorReason.TRANSIENT, str(exc)[:_MAX_DETAIL_CHARS]
    if not isinstance(exc, openai.APIStatusError):
        return LlmErrorReason.OTHER, str(exc)[:_MAX_DETAIL_CHARS]
    status = exc.status_code
    body = exc.body if isinstance(exc.body, dict) else {}
    # 保留廠商自己的說明（例如「Incorrect API key provided」），使用者才知道要去哪裡修。
    message = str(body.get("message") or "")[:_MAX_DETAIL_CHARS]
    detail = f"HTTP {status}" + (f" {message}" if message else "")
    if status == 429:
        # OpenAI 用 429 回報帳戶餘額用完，這種重試也沒用。
        code = body.get("code")
        return (LlmErrorReason.QUOTA if code == "insufficient_quota" else LlmErrorReason.TRANSIENT), detail
    if status >= 500:
        return LlmErrorReason.TRANSIENT, detail
    if status in (401, 403):
        return LlmErrorReason.AUTH, detail
    if status == 402:
        return LlmErrorReason.QUOTA, detail
    if status == 404:
        return LlmErrorReason.MODEL_NOT_FOUND, detail
    if body.get("code") == "tool_use_failed":
        return LlmErrorReason.MALFORMED_TOOL_CALL, detail
    return LlmErrorReason.OTHER, detail


def _as_llm_error(model: ChatModel, exc: openai.APIError) -> LlmError:
    reason, detail = _classify(exc)
    return LlmError(model.provider, model.model, reason, detail)


def _create(
    model: ChatModel, messages: list[dict[str, Any]], max_tokens: int, *, meter: UsageSink | None, **stream_args: Any
) -> Any:
    """送出請求；廠商拒絕時轉成 LlmError，並記一筆沒有數字的失敗用量。"""
    try:
        return _client(model).chat.completions.create(
            model=model.model, messages=messages, max_tokens=max_tokens,  # type: ignore[arg-type]
            extra_body=model.extra_body, **stream_args)
    except openai.APIError as exc:
        if meter:
            meter.record(model, UNKNOWN_USAGE, succeeded=False)
        raise _as_llm_error(model, exc) from exc


def chat(model: ChatModel, messages: list[dict[str, str]], *, max_tokens: int, meter: UsageSink | None) -> ChatResult:
    response = _create(model, messages, max_tokens, meter=meter)
    result = ChatResult(text=strip_thinking(response.choices[0].message.content or ""), usage=_usage(response.usage))
    if meter:
        meter.record(model, result.usage, succeeded=True)
    return result


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    arguments: str  # JSON 字串，照模型給的原樣；可能不合法，由呼叫端檢查


@dataclass(frozen=True)
class ToolTurn:
    """會呼叫工具的一輪。message 是要原樣放回對話的 assistant 訊息——包含廠商自己加的欄位（例如 Gemini 3 每個工具呼叫
    的 thought_signature，下一輪沒帶回去就是 400）。沒有 tool_calls 就是最後的回答（text）。"""

    message: dict[str, Any]
    tool_calls: list[ToolCall]
    text: str
    usage: TokenUsage


def chat_with_tools(
    model: ChatModel, messages: list[dict[str, Any]], tools: list[dict[str, Any]], *, max_tokens: int,
    meter: UsageSink | None,
) -> ToolTurn:
    response = _create(model, messages, max_tokens, meter=meter, tools=tools)
    message = response.choices[0].message
    usage = _usage(response.usage)
    if meter:
        meter.record(model, usage, succeeded=True)
    raw = message.model_dump(exclude_none=True)
    raw.setdefault("content", "")
    calls = [ToolCall(call.id, call.function.name, call.function.arguments or "{}") for call in (message.tool_calls or [])]
    return ToolTurn(message=raw, tool_calls=calls, text=strip_thinking(message.content or ""), usage=usage)


class ChatStream:
    """串流回答：逐段 yield 文字（已去掉混進來的 think 區塊）；迭代完之後 `usage` 才是廠商回報的用量。
    串流結束、出錯或被中途放棄時，把用量交給 meter（只有完整讀完才算成功）。"""

    def __init__(self, model: ChatModel, chunks: Iterable[Any], meter: UsageSink | None):
        self._model = model
        self._chunks = chunks
        self._meter = meter
        self.usage = UNKNOWN_USAGE

    def __iter__(self) -> Iterator[str]:
        yield from stream_without_thinking(self._deltas())

    def _deltas(self) -> Iterator[str]:
        finished = False
        try:
            for chunk in self._chunks:
                if chunk.usage is not None:  # 要求了 include_usage 時，最後一個 chunk 只帶用量、choices 是空的
                    self.usage = _usage(chunk.usage)
                if chunk.choices:
                    yield chunk.choices[0].delta.content or ""
            finished = True
        except openai.APIError as exc:
            raise _as_llm_error(self._model, exc) from exc
        finally:
            if self._meter:
                self._meter.record(self._model, self.usage, succeeded=finished)


def stream_chat(
    model: ChatModel, messages: list[dict[str, str]], *, max_tokens: int, meter: UsageSink | None
) -> ChatStream:
    chunks = _create(model, messages, max_tokens, meter=meter, stream=True, stream_options={"include_usage": True})
    return ChatStream(model, chunks, meter)


def strip_thinking(text: str) -> str:
    """去掉輸出裡混進 content 的 <think>...</think> chain-of-thought，防禦性用途。

    目前用的 Qwen/Qwen3.5-9B 關掉 thinking（PLATFORM_LLM_EXTRA_BODY）之後，reasoning 是獨立欄位、不會混進
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
