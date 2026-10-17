import json
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.services import pipeline
from app.services.chapter_generator import TimedLine


class FakeSegment:
    def __init__(self, start_time: float, end_time: float, speaker_label: str, text: str):
        self.start_time = start_time
        self.end_time = end_time
        self.speaker_label = speaker_label
        self.text = text


def test_process_message_happy_path_calls_everything_in_order_and_persists_results():
    """驅動 process_message() 的 happy path，全部三個外部 I/O 邊界（HF、兩個 gRPC client）
    加上資料庫層都用 mock 取代，證明這個 seam 真的能用——之後的重試相關票券會直接複用同一套
    mocking 方式來注入失敗情境。

    NOTE 給之後寫測試的人：mock 一定要 patch 在 `pipeline` 模組「使用端」import 進來的名稱
    （例如 `pipeline.summarize`、`pipeline.job_status_client`），不是「定義端」的原始模組
    （例如 `app.services.summarizer.summarize`）——`unittest.mock.patch` 只會替換掉「name
    binding」，pipeline.py 早就把這些名稱 import 進自己的 namespace 了，patch 定義端不會影響
    pipeline.py 實際呼叫到的是誰。
    """
    job_id = str(uuid.uuid4())
    body = json.dumps({"jobId": job_id}).encode("utf-8")

    segments = [
        FakeSegment(0.0, 5.0, "A", "哈囉大家好"),
        FakeSegment(5.0, 10.0, "B", "今天來聊聊逐字稿"),
    ]
    transcript = SimpleNamespace(full_text="哈囉大家好 今天來聊聊逐字稿", segments=segments, revision=0, speakers=[])

    manager = MagicMock()
    mock_session = MagicMock(name="session")

    with (
        patch.object(pipeline, "job_status_client") as mock_job_status_client,
        patch.object(pipeline, "transcript_client") as mock_transcript_client,
        patch.object(pipeline, "summarize") as mock_summarize,
        patch.object(pipeline, "generate_chapters") as mock_generate_chapters,
        patch.object(pipeline, "embed_documents") as mock_embed_documents,
        patch.object(pipeline, "new_session", return_value=mock_session),
        patch.object(pipeline, "save_summary") as mock_save_summary,
        patch.object(pipeline, "save_chapters") as mock_save_chapters,
        patch.object(pipeline, "save_embeddings") as mock_save_embeddings,
    ):
        mock_transcript_client.get_transcript.return_value = transcript
        mock_summarize.return_value = "這是摘要"
        mock_generate_chapters.return_value = [("開場", 0.0)]
        mock_embed_documents.return_value = [[0.1, 0.2], [0.3, 0.4]]

        for name, mock in [
            ("update_status", mock_job_status_client.update_status),
            ("get_transcript", mock_transcript_client.get_transcript),
            ("summarize", mock_summarize),
            ("generate_chapters", mock_generate_chapters),
            ("embed_documents", mock_embed_documents),
            ("save_summary", mock_save_summary),
            ("save_chapters", mock_save_chapters),
            ("save_embeddings", mock_save_embeddings),
        ]:
            manager.attach_mock(mock, name)

        publish_completed = MagicMock()
        publish_failed = MagicMock()
        manager.attach_mock(publish_completed, "publish_completed")

        pipeline.process_message(body, publish_completed, publish_failed)

    # 呼叫順序：標記處理中 -> 取得逐字稿 -> 摘要 -> 章節 -> embedding -> 三個存檔 -> 標記完成 -> 發完成事件
    assert [call[0] for call in manager.mock_calls] == [
        "update_status",
        "get_transcript",
        "summarize",
        "generate_chapters",
        "embed_documents",
        "save_summary",
        "save_chapters",
        "save_embeddings",
        "update_status",
        "publish_completed",
    ]

    assert mock_job_status_client.update_status.call_args_list == [
        ((job_id, "SUMMARIZING"), {}),
        ((job_id, "COMPLETED"), {}),
    ]
    mock_transcript_client.get_transcript.assert_called_once_with(job_id)
    assert mock_summarize.call_args.args == (transcript.full_text,)
    assert mock_generate_chapters.call_args.args == ([TimedLine(0.0, "哈囉大家好"), TimedLine(5.0, "今天來聊聊逐字稿")],)
    mock_embed_documents.assert_called_once_with(["哈囉大家好", "今天來聊聊逐字稿"])

    mock_save_summary.assert_called_once_with(
        mock_session, uuid.UUID(job_id), "這是摘要", source_revision=0, model=("platform", "Qwen/Qwen3.5-9B"))
    mock_save_chapters.assert_called_once_with(mock_session, uuid.UUID(job_id), [("開場", 0.0)])
    mock_save_embeddings.assert_called_once_with(
        mock_session,
        uuid.UUID(job_id),
        [
            ("哈囉大家好", 0.0, 5.0, [0.1, 0.2]),
            ("今天來聊聊逐字稿", 5.0, 10.0, [0.3, 0.4]),
        ],
    )

    publish_completed.assert_called_once_with(job_id)
    publish_failed.assert_not_called()
    mock_session.close.assert_called_once()


def test_process_message_leaves_cleared_segments_out_and_records_the_transcript_revision():
    """A transcript can be edited before (or while) the pipeline runs: cleared segments (empty text)
    aren't content, and the summary remembers which revision of the transcript it was built from, so
    a later edit can tell it's 過時."""
    job_id = str(uuid.uuid4())
    body = json.dumps({"jobId": job_id}).encode("utf-8")
    kept = [FakeSegment(0.0, 5.0, "", "哈囉大家好"), FakeSegment(8.0, 10.0, "", "今天來聊聊逐字稿")]
    transcript = SimpleNamespace(
        full_text="哈囉大家好\n今天來聊聊逐字稿",
        revision=3,
        segments=[kept[0], FakeSegment(5.0, 8.0, "", ""), kept[1]],
        speakers=[],
    )

    with (
        patch.object(pipeline, "job_status_client"),
        patch.object(pipeline, "transcript_client") as mock_transcript_client,
        patch.object(pipeline, "summarize", return_value="摘要"),
        patch.object(pipeline, "generate_chapters", return_value=[]) as mock_generate_chapters,
        patch.object(pipeline, "embed_documents", return_value=[[0.1], [0.2]]) as mock_embed_documents,
        patch.object(pipeline, "new_session", return_value=MagicMock(name="session")),
        patch.object(pipeline, "save_summary") as mock_save_summary,
        patch.object(pipeline, "save_chapters"),
        patch.object(pipeline, "save_embeddings") as mock_save_embeddings,
    ):
        mock_transcript_client.get_transcript.return_value = transcript
        pipeline.process_message(body, MagicMock(), MagicMock())

    assert mock_generate_chapters.call_args.args == ([TimedLine(0.0, "哈囉大家好"), TimedLine(8.0, "今天來聊聊逐字稿")],)
    mock_embed_documents.assert_called_once_with(["哈囉大家好", "今天來聊聊逐字稿"])
    assert [chunk[0] for chunk in mock_save_embeddings.call_args.args[2]] == ["哈囉大家好", "今天來聊聊逐字稿"]
    assert mock_save_summary.call_args.kwargs["source_revision"] == 3


def test_the_pipeline_asks_the_platform_model_for_the_summary_and_the_chapters(fake_llm):
    """End to end through the real summarize() / generate_chapters(): only the model provider (at the HTTP
    layer), the gRPC clients, the embedder and the database are faked."""
    job_id = str(uuid.uuid4())
    transcript = SimpleNamespace(
        full_text="大家好\n今天談預算", revision=0, speakers=[],
        segments=[FakeSegment(0.0, 5.0, "", "大家好"), FakeSegment(5.0, 9.0, "", "今天談預算")],
    )
    fake_llm.reply("這場會議討論預算")
    fake_llm.reply('[{"title": "預算", "start_time": 5.0}]')

    with (
        patch.object(pipeline, "job_status_client"),
        patch.object(pipeline, "transcript_client") as mock_transcript_client,
        patch.object(pipeline, "embed_documents", return_value=[[0.1], [0.2]]),
        patch.object(pipeline, "new_session", return_value=MagicMock(name="session")),
        patch.object(pipeline, "save_summary") as mock_save_summary,
        patch.object(pipeline, "save_chapters") as mock_save_chapters,
        patch.object(pipeline, "save_embeddings"),
    ):
        mock_transcript_client.get_transcript.return_value = transcript
        pipeline.process_message(json.dumps({"jobId": job_id}).encode(), MagicMock(), MagicMock())

    # The summary, the chapters, then the title (test_job_details.py).
    assert [body["model"] for body in fake_llm.bodies()] == ["Qwen/Qwen3.5-9B"] * 3
    assert "大家好\n今天談預算" in fake_llm.bodies()[0]["messages"][0]["content"]
    assert "[5.0] 今天談預算" in fake_llm.bodies()[1]["messages"][0]["content"]
    assert mock_save_summary.call_args.args[2] == "這場會議討論預算"
    assert mock_save_chapters.call_args.args[2] == [("預算", 5.0)]


def test_without_an_embedding_server_the_job_still_completes_without_vectors():
    job_id = str(uuid.uuid4())
    transcript = SimpleNamespace(full_text="大家好", revision=0, speakers=[], segments=[FakeSegment(0.0, 5.0, "", "大家好")])

    with (
        patch.object(pipeline.embedder.settings, "embedding_base_url", ""),
        patch.object(pipeline, "job_status_client") as status_client,
        patch.object(pipeline, "transcript_client") as mock_transcript_client,
        patch.object(pipeline, "summarize", return_value="摘要"),
        patch.object(pipeline, "generate_chapters", return_value=[]),
        patch.object(pipeline, "embed_documents") as mock_embed_documents,
        patch.object(pipeline, "new_session", return_value=MagicMock(name="session")),
        patch.object(pipeline, "save_summary"),
        patch.object(pipeline, "save_chapters"),
        patch.object(pipeline, "save_embeddings") as mock_save_embeddings,
    ):
        mock_transcript_client.get_transcript.return_value = transcript
        pipeline.process_message(json.dumps({"jobId": job_id}).encode(), MagicMock(), MagicMock())

    mock_embed_documents.assert_not_called()
    mock_save_embeddings.assert_not_called()
    status_client.update_status.assert_any_call(job_id, "COMPLETED")
