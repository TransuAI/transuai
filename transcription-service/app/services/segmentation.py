"""把語音辨識的逐字資料切成片段（跟廠商無關）。

切的時機：換講者、上一個字以句末標點結尾、字與字之間停頓 0.5 秒以上、或片段即將超過 15 秒（在字的邊界強制切）。
所以每個片段只屬於一位講者。中文轉錄實際上幾乎沒有標點，片段主要靠停頓切開（見 ADR 0001）。

廠商的講者標籤依第一次出現的順序換成這個 Job 自己的標籤（S1、S2…），講者編號因此永遠從第一個開口的人算起。
"""

import unicodedata

from app.services.speech_recognition import Recognition, RecognizedWord
from app.services.transcript_result import TranscriptResult, TranscriptSegment

MAX_SEGMENT_SECONDS = 15.0
PAUSE_SECONDS = 0.5
_SENTENCE_FINAL = ("。", "？", "！", "…", ".", "?", "!")
# 句末標點後面可能還接著引號或括號（例如 `好。」`），判斷時先去掉。
_CLOSING_MARKS = "」』）)\"'”’"


def build_transcript(recognition: Recognition) -> TranscriptResult:
    job_labels: dict[str, str] = {}

    def job_label(vendor_label: str | None) -> str | None:
        if vendor_label is None:
            return None
        return job_labels.setdefault(vendor_label, f"S{len(job_labels) + 1}")

    segments: list[TranscriptSegment] = []
    current: list[RecognizedWord] = []
    for word in recognition.words:
        if not word.text.strip():
            continue
        if current and _starts_new_segment(current, word):
            segments.append(_to_segment(current, job_label(current[0].speaker)))
            current = []
        current.append(word)
    if current:
        segments.append(_to_segment(current, job_label(current[0].speaker)))

    return TranscriptResult(
        language=recognition.language,
        full_text="\n".join(segment.text for segment in segments),
        segments=segments,
        speaker_labels=list(job_labels.values()),
    )


def _starts_new_segment(current: list[RecognizedWord], word: RecognizedWord) -> bool:
    previous = current[-1]
    # 時間戳是浮點數（例如 31.920937），相減會有誤差，先四捨五入到毫秒再比較。
    return (
        word.speaker != previous.speaker
        or previous.text.rstrip(_CLOSING_MARKS).endswith(_SENTENCE_FINAL)
        or round(word.start - previous.end, 3) >= PAUSE_SECONDS
        or round(word.end - current[0].start, 3) > MAX_SEGMENT_SECONDS
    )


def _to_segment(words: list[RecognizedWord], speaker_label: str | None) -> TranscriptSegment:
    text = words[0].text
    for word in words[1:]:
        text += _separator(text[-1], word.text[0]) + word.text
    return TranscriptSegment(start=words[0].start, end=words[-1].end, text=text, speaker_label=speaker_label)


def _separator(before: str, after: str) -> str:
    # 中文（含全形標點）跟任何字相鄰都不加空白；兩邊都不是中文（英文、數字、半形標點）才加一個空白。
    return "" if _is_wide(before) or _is_wide(after) else " "


def _is_wide(char: str) -> bool:
    return unicodedata.east_asian_width(char) in ("W", "F")
