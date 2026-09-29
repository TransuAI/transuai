"""講者名字建議（見 CONTEXT.md「講者名字建議」）：摘要之後請模型讀整份逐字稿（每行「[分:秒] 講者 N：文字」），只在錄音裡**明確講出**
某位講者是誰時提出名字與依據；再由程式驗證，對不上的一律丟掉——寧可不建議，也不要猜錯。講者分離本來就不辨認身分，這裡也不
辨認聲音，只讀講出來的話。任何失敗回 None，由呼叫端決定（pipeline 只記 log）。"""

import logging
from collections import Counter

from app.proto_gen import transcription_pb2
from app.repositories.speaker_suggestion_repository import SpeakerSuggestionRecord
from app.services.agent_tools import normalize_text, timed_line
from app.services.chapter_generator import parse_json_reply
from app.services.llm_client import ChatModel, LlmError, chat
from app.services.speaker_context import speaker_names, spoken_segments
from app.services.usage_meter import UsageMeter

logger = logging.getLogger(__name__)

_MAX_NAME_CHARS = 30
_MAX_TOKENS = 600
# 模型照抄的「分:秒」對到片段開始時間時容許的誤差（片段時間有小數，顯示時捨去）。
_TIME_TOLERANCE_SECONDS = 3
# 自我介紹：名字前面這幾個字以內要有自我介紹的說法（正規化後比對：小寫、去掉空白與標點）。「Thanks Eric」「謝謝小明」這類
# 提到別人的話就過不了。
_SELF_INTRODUCTION_CUES = ("im", "iam", "thisis", "mynameis", "我是", "我叫", "敝姓", "本人是", "我的名字是", "我姓")
_CUE_WINDOW = 12

_PROMPT_TEMPLATE = (
    "以下是一段錄音的逐字稿，每行是「[分:秒] 講者：說的話」。講者只用編號區分（講者 1、講者 2…），系統不知道他們是誰。\n"
    "請找出錄音裡**明確講出**身分的講者，只有兩種情況算數：\n"
    "- self（自我介紹）：講者自己說出自己的名字，例如「我是王小明」「This is Eric Johnson」「I'm Sid」。\n"
    "- introduced（被介紹）：講者介紹下一位要發言的人，例如「接下來請 Jennifer 說明」，而且下一段換成另一位講者開口——那位講者就是被介紹的人。\n"
    "注意：提到或感謝別人（「謝謝 Eric」「Thanks Eric」「剛剛小明說的」）**不代表**說這句話的人是那個人，不能當依據。\n"
    "沒有把握就不要列。名字照錄音裡的原文，不要翻譯、不要補全姓氏。\n"
    '只回傳 JSON 陣列，每一筆 {{"speaker": "講者 N", "name": "名字", "time": "依據那一行的分:秒", "kind": "self 或 introduced"}}；'
    "沒有任何一位就回 []。不要其他文字。\n\n{lines}"
)


def suggest_speaker_names(transcript: transcription_pb2.Transcript, *, model: ChatModel,
                          meter: UsageMeter) -> list[SpeakerSuggestionRecord] | None:
    """兩位以上講者時，替還沒改名的講者提出有依據的名字；沒有依據的丟掉。模型失敗或回的不是 JSON 陣列就是 None。"""
    names = speaker_names(transcript)
    if names is None:
        return []
    segments = spoken_segments(transcript)
    lines = "\n".join(timed_line(float(s.start_time), names.get(s.speaker_label), s.text) for s in segments)
    try:
        reply = chat(model, [{"role": "user", "content": _PROMPT_TEMPLATE.format(lines=lines)}],
                     max_tokens=_MAX_TOKENS, meter=meter)
    except LlmError:
        logger.warning("could not ask for speaker names", exc_info=True)
        return None
    try:
        data = parse_json_reply(reply.text)
    except ValueError:
        logger.warning("the speaker names answer is not JSON: %r", reply.text[:200])
        return None
    if not isinstance(data, list):
        return None

    # Only speakers still called 「講者 N」: a name the user gave stays theirs.
    unnamed = {s.display_name: s for s in transcript.speakers if s.display_name == f"講者 {s.display_order}"}
    grounded = [record for item in data if (record := _grounded(item, unnamed, segments))]

    # One name per speaker, one speaker per name: anything contested is dropped on both sides.
    per_speaker = Counter(r.speaker_label for r in grounded)
    per_name = Counter(normalize_text(r.name) for r in grounded)
    kept = [r for r in grounded if per_speaker[r.speaker_label] == 1 and per_name[normalize_text(r.name)] == 1]
    order = {s.label: s.display_order for s in transcript.speakers}
    return sorted(kept, key=lambda r: order.get(r.speaker_label, 0))


def _grounded(item: object, unnamed: dict[str, transcription_pb2.Speaker],
              segments: list[transcription_pb2.TranscriptSegment]) -> SpeakerSuggestionRecord | None:
    """模型的一筆建議，對得上錄音才留下：講者是還沒改名的講者、那個時間有一句含這個名字的話、而且說話的人對得上。"""
    if not isinstance(item, dict):
        return None
    speaker = unnamed.get(str(item.get("speaker", "")).strip())
    name = item.get("name")
    seconds = _seconds(item.get("time"))
    kind = item.get("kind")
    if speaker is None or not isinstance(name, str) or seconds is None or kind not in ("self", "introduced"):
        return None
    name = name.strip()
    wanted = normalize_text(name)
    if not wanted or len(name) > _MAX_NAME_CHARS:
        return None
    for i, segment in enumerate(segments):
        if abs(float(segment.start_time) - seconds) > _TIME_TOLERANCE_SECONDS or wanted not in normalize_text(segment.text):
            continue
        if kind == "self" and segment.speaker_label == speaker.label and _introduces_self(segment.text, wanted):
            return SpeakerSuggestionRecord(speaker.label, name, float(segment.start_time), segment.text)
        if kind == "introduced" and segment.speaker_label != speaker.label \
                and _next_speaker(segments, i) == speaker.label:
            return SpeakerSuggestionRecord(speaker.label, name, float(segment.start_time), segment.text)
    return None


def _introduces_self(text: str, wanted: str) -> bool:
    normalized = normalize_text(text)
    at = normalized.find(wanted)
    return any(cue in normalized[max(0, at - _CUE_WINDOW):at] for cue in _SELF_INTRODUCTION_CUES)


def _next_speaker(segments: list[transcription_pb2.TranscriptSegment], i: int) -> str | None:
    """第 i 段之後，第一段換成別人說話的講者。"""
    for segment in segments[i + 1:]:
        if segment.speaker_label != segments[i].speaker_label:
            return segment.speaker_label
    return None


def _seconds(shown: object) -> float | None:
    """「12:34」或「1:02:03」→ 秒數；不是時間就是 None。"""
    parts = str(shown).strip().split(":") if isinstance(shown, str) else []
    if not 2 <= len(parts) <= 3 or not all(part.isdigit() for part in parts):
        return None
    seconds = 0.0
    for part in parts:
        seconds = seconds * 60 + int(part)
    return seconds
