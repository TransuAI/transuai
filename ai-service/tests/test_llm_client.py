"""生成類呼叫走 OpenAI 相容介面：用假的 AI 廠商（HTTP 層，見 conftest.FakeLlmProvider）驗證實際送出的
請求、回應的文字與 token 用量、錯誤分類。"""

import httpx2
import pytest

from app.services import llm_client
from app.services.chapter_generator import TimedLine, generate_chapters
from app.services.llm_client import (
    LlmError,
    LlmErrorReason,
    TokenUsage,
    chat,
    platform_chat_model,
    stream_chat,
    stream_without_thinking,
)
from app.services.retry import is_retryable_error
from app.services.summarizer import summarize


def test_summaries_go_to_the_platform_model_over_the_openai_compatible_router(fake_llm):
    fake_llm.reply("這是摘要")

    assert summarize("今天開會討論預算", model=platform_chat_model(), meter=None) == "這是摘要"

    [request] = fake_llm.requests
    assert str(request.url) == "https://router.huggingface.co/v1/chat/completions"
    assert request.headers["Authorization"] == "Bearer hf-test-key"
    [body] = fake_llm.bodies()
    assert body["model"] == "Qwen/Qwen3.5-9B"
    assert body["chat_template_kwargs"] == {"enable_thinking": False}
    assert "今天開會討論預算" in body["messages"][0]["content"]


def test_chapters_are_parsed_from_the_models_reply(fake_llm):
    fake_llm.reply('[{"title": "預算", "start_time": 12.0}, {"title": "開場", "start_time": 0}]')

    assert generate_chapters([TimedLine(0.0, "大家好"), TimedLine(12.0, "來談預算")], model=platform_chat_model(), meter=None) == [("開場", 0.0), ("預算", 12.0)]


def test_a_reply_reports_the_tokens_it_used(fake_llm):
    fake_llm.reply("答案", usage=(120, 30))

    result = chat(platform_chat_model(), [{"role": "user", "content": "問題"}], max_tokens=100, meter=None)

    assert (result.text, result.usage) == ("答案", TokenUsage(input_tokens=120, output_tokens=30))


def test_a_reply_without_usage_has_unknown_usage(fake_llm):
    fake_llm.reply("答案", usage=None)

    assert chat(platform_chat_model(), [{"role": "user", "content": "問題"}], max_tokens=100, meter=None).usage == TokenUsage(None, None)


def test_a_stream_yields_the_text_and_then_knows_its_usage(fake_llm):
    fake_llm.stream(["蘋果", "、香蕉", "、葡萄"], usage=(15, 6))

    stream = stream_chat(platform_chat_model(), [{"role": "user", "content": "說三個水果"}], max_tokens=100, meter=None)
    text = "".join(stream)

    assert text == "蘋果、香蕉、葡萄"
    assert stream.usage == TokenUsage(input_tokens=15, output_tokens=6)
    assert fake_llm.bodies()[0]["stream_options"] == {"include_usage": True}


def test_a_stream_without_usage_has_unknown_usage(fake_llm):
    fake_llm.stream(["好"], usage=None)

    stream = stream_chat(platform_chat_model(), [{"role": "user", "content": "嗨"}], max_tokens=100, meter=None)
    list(stream)

    assert stream.usage == TokenUsage(None, None)


def test_a_think_block_mixed_into_the_reply_is_dropped(fake_llm):
    fake_llm.reply("<think>先想一想</think>真正的答案")

    assert chat(platform_chat_model(), [{"role": "user", "content": "問題"}], max_tokens=100, meter=None).text == "真正的答案"


@pytest.mark.parametrize("status, error, reason", [
    (429, {"message": "Rate limit reached"}, LlmErrorReason.TRANSIENT),
    (500, None, LlmErrorReason.TRANSIENT),
    (503, None, LlmErrorReason.TRANSIENT),
    (401, None, LlmErrorReason.AUTH),
    (403, None, LlmErrorReason.AUTH),
    (402, None, LlmErrorReason.QUOTA),
    # OpenAI reports an exhausted balance as a 429, which retrying can't fix.
    (429, {"message": "You exceeded your current quota", "code": "insufficient_quota"}, LlmErrorReason.QUOTA),
    (404, None, LlmErrorReason.MODEL_NOT_FOUND),
    (400, None, LlmErrorReason.OTHER),
])
def test_provider_errors_are_classified(fake_llm, status, error, reason):
    fake_llm.fail(status, error)

    with pytest.raises(LlmError) as raised:
        summarize("逐字稿", model=platform_chat_model(), meter=None)

    assert raised.value.reason == reason
    assert raised.value.provider == "platform"
    assert is_retryable_error(raised.value) is (reason == LlmErrorReason.TRANSIENT)


def test_an_unreachable_provider_is_a_transient_error(monkeypatch):
    def refuse(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("connection refused", request=request)

    monkeypatch.setattr(llm_client, "_http_client", httpx2.Client(transport=httpx2.MockTransport(refuse)))

    with pytest.raises(LlmError) as raised:
        summarize("逐字稿", model=platform_chat_model(), meter=None)

    assert raised.value.reason == LlmErrorReason.TRANSIENT
    assert is_retryable_error(raised.value) is True


def test_a_provider_that_times_out_is_a_transient_error(monkeypatch):
    def time_out(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ReadTimeout("timed out", request=request)

    monkeypatch.setattr(llm_client, "_http_client", httpx2.Client(transport=httpx2.MockTransport(time_out)))

    with pytest.raises(LlmError) as raised:
        summarize("逐字稿", model=platform_chat_model(), meter=None)

    assert raised.value.reason == LlmErrorReason.TRANSIENT


def test_the_error_keeps_the_providers_own_explanation(fake_llm):
    fake_llm.fail(401, {"message": "Incorrect API key provided"})

    with pytest.raises(LlmError) as raised:
        summarize("逐字稿", model=platform_chat_model(), meter=None)

    assert "Incorrect API key provided" in str(raised.value)
    assert str(raised.value).startswith("平台模型（Qwen/Qwen3.5-9B）金鑰無效或沒有權限")


def test_an_error_in_the_middle_of_a_stream_is_raised_as_a_model_error(fake_llm):
    fake_llm.stream_then_fail(["一半的"], "upstream disconnected")

    stream = stream_chat(platform_chat_model(), [{"role": "user", "content": "問題"}], max_tokens=100, meter=None)
    with pytest.raises(LlmError) as raised:
        list(stream)

    assert "upstream disconnected" in str(raised.value)


def test_the_client_does_not_retry_on_its_own(fake_llm):
    # Retries happen at the message level (ai-service ADR 0001), not inside the HTTP client.
    fake_llm.fail(503)

    with pytest.raises(LlmError):
        summarize("逐字稿", model=platform_chat_model(), meter=None)

    assert len(fake_llm.requests) == 1


# --- stream_without_thinking：防禦性地去掉混進串流開頭的 <think> 區塊 ---


def test_a_short_answer_is_not_lost():
    # Shorter than "<think>": the whole answer used to stay in the buffer when the stream ended.
    assert "".join(stream_without_thinking(["沒有", "。"])) == "沒有。"


def test_a_leading_think_block_is_dropped():
    assert "".join(stream_without_thinking(["<think>", "想一想", "</think>", "答案是", "四十二"])) == "答案是四十二"


def test_once_it_is_clear_there_is_no_think_block_deltas_pass_straight_through():
    assert list(stream_without_thinking(["今天的", "重點是", "預算", "。"])) == ["今天的重點是預算", "。"]


def test_an_unfinished_think_block_yields_nothing():
    assert "".join(stream_without_thinking(["<think>", "還在想"])) == ""
