import json
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.services import pipeline


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
    transcript = SimpleNamespace(full_text="哈囉大家好 今天來聊聊逐字稿", segments=segments)

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
    mock_summarize.assert_called_once_with(transcript.full_text)
    mock_generate_chapters.assert_called_once_with(segments)
    mock_embed_documents.assert_called_once_with(["哈囉大家好", "今天來聊聊逐字稿"])

    mock_save_summary.assert_called_once_with(mock_session, uuid.UUID(job_id), "這是摘要")
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
