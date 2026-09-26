"""讓 AI 知道講者是誰（見 transcription-service CONTEXT.md「講者」）：只有兩位以上講者時，交給 LLM 的逐字稿
每一行帶上講者**目前的**顯示名稱（transcription-service 決定好的，改名後下一次讀逐字稿就是新名字）。只有一位
講者，或講者分離之前的舊逐字稿，輸入維持原樣。已清空片段一律不算內容。

embedding 永遠只依片段文字——名字會改，改名不能讓 embedding 過期（問答在回答當下才換上名字，見 qa.py）。
"""

from app.proto_gen import transcription_pb2
from app.services.chapter_generator import TimedLine
from app.services.segment_times import time_key


def spoken_segments(transcript: transcription_pb2.Transcript) -> list[transcription_pb2.TranscriptSegment]:
    """有內容的片段：已清空片段（文字是空的）不算。"""
    return [segment for segment in transcript.segments if segment.text != ""]


def speaker_names(transcript: transcription_pb2.Transcript) -> dict[str, str] | None:
    """講者標籤 -> 目前的顯示名稱；有內容的片段裡出現的講者少於兩位時是 None（不帶名字）。"""
    names = {speaker.label: speaker.display_name for speaker in transcript.speakers}
    if len(names) < 2:
        return None
    speaking = {segment.speaker_label for segment in spoken_segments(transcript) if segment.speaker_label in names}
    return names if len(speaking) >= 2 else None


def with_speaker_name(text: str, name: str | None) -> str:
    """交給 LLM 的一行：「名稱：文字」，沒有名字時就是文字本身。"""
    return f"{name}：{text}" if name else text


def summary_input(transcript: transcription_pb2.Transcript) -> str:
    names = speaker_names(transcript)
    if names is None:
        return transcript.full_text
    return "\n".join(with_speaker_name(s.text, names.get(s.speaker_label)) for s in spoken_segments(transcript))


def chapter_input(transcript: transcription_pb2.Transcript) -> list[TimedLine]:
    names = speaker_names(transcript) or {}
    return [
        TimedLine(float(s.start_time), with_speaker_name(s.text, names.get(s.speaker_label)))
        for s in spoken_segments(transcript)
    ]


def speaker_names_by_segment_time(transcript: transcription_pb2.Transcript) -> dict[tuple[float, float], str]:
    """片段起訖時間（`segment_times.time_key`）-> 講者目前的顯示名稱，讓問答把檢索到的 embedding 對回講者；
    不帶名字時（見 speaker_names）是空的。"""
    names = speaker_names(transcript)
    if names is None:
        return {}
    return {
        time_key(segment.start_time, segment.end_time): names[segment.speaker_label]
        for segment in spoken_segments(transcript)
        if segment.speaker_label in names
    }
