from dataclasses import dataclass, field


@dataclass
class TranscriptSegment:
    start: float
    end: float
    text: str
    # 這個 Job 內的講者標籤（見 app/services/segmentation.py）；None＝沒有講者資訊。
    speaker_label: str | None = None


@dataclass
class TranscriptResult:
    """切好片段、準備存檔的逐字稿。"""

    language: str
    full_text: str
    segments: list[TranscriptSegment]
    # 片段用到的講者標籤，依顯示順序（第一次開口的順序）；沒有講者資訊時是空的。
    speaker_labels: list[str] = field(default_factory=list)
