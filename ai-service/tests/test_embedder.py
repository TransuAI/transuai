"""embedder：OpenAI 相容的 /v1/embeddings（本地 vLLM），假的伺服器在 HTTP 層（conftest 的 fake_embedder）。"""

from unittest.mock import patch

import pytest

from app.services import embedder
from app.services.embedder import EmbeddingError


def test_documents_go_to_the_configured_server_and_model_as_they_are(fake_embedder):
    vectors = embedder.embed_documents(["大家好", "今天談預算"])

    request = fake_embedder.requests[0]
    assert str(request.url) == "https://embed.test/v1/embeddings"
    assert fake_embedder.bodies()[0]["model"] == "Qwen/Qwen3-Embedding-0.6B"
    assert fake_embedder.bodies()[0]["input"] == ["大家好", "今天談預算"]  # documents get no instruction
    assert [v[0] for v in vectors] == [0.0, 1.0] and len(vectors[0]) == 1024


def test_a_long_transcript_is_sent_in_batches_and_comes_back_in_order(fake_embedder):
    texts = [f"第 {i} 段" for i in range(150)]

    vectors = embedder.embed_documents(texts)

    assert [len(body["input"]) for body in fake_embedder.bodies()] == [64, 64, 22]
    assert len(vectors) == 150


def test_a_question_carries_the_instruction_an_instruction_aware_model_wants(fake_embedder):
    with patch.object(embedder.settings, "embedding_query_instruction", "找出回答問題的逐字稿片段"):
        embedder.embed_query("預算怎麼了？")

    assert fake_embedder.bodies()[0]["input"] == ["Instruct: 找出回答問題的逐字稿片段\nQuery:預算怎麼了？"]


def test_without_an_instruction_the_question_is_sent_as_it_is(fake_embedder):
    embedder.embed_query("預算怎麼了？")

    assert fake_embedder.bodies()[0]["input"] == ["預算怎麼了？"]


@pytest.mark.parametrize("status, transient", [(503, True), (429, True), (400, False), (404, False)])
def test_failures_say_whether_a_retry_could_help(fake_embedder, status, transient):
    fake_embedder.fail(status)

    with pytest.raises(EmbeddingError) as raised:
        embedder.embed_documents(["大家好"])

    assert raised.value.transient is transient


def test_a_model_with_other_dimensions_is_refused_rather_than_stored(fake_embedder, monkeypatch):
    monkeypatch.setattr(embedder, "DIMENSIONS", 768)

    with pytest.raises(EmbeddingError, match="768"):
        embedder.embed_documents(["大家好"])


def test_nothing_is_configured_out_of_the_box(fake_embedder):
    with patch.object(embedder.settings, "embedding_base_url", ""):
        assert not embedder.is_configured()
        with pytest.raises(EmbeddingError, match="尚未設定") as raised:
            embedder.embed_query("預算怎麼了？")

    assert raised.value.transient is False
    assert fake_embedder.requests == []
