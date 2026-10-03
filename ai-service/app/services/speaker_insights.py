"""講者數據的 AI 判斷（見 .scratch/speaker-analytics）：每位講者提出的**問題**、可能的**打斷**。中文逐字稿幾乎沒有標點，問題數不出
問號、也看不出上一句講完了沒有，所以交給模型判斷——但只讓它挑：

- 每一行有編號（`[n] [分:秒] 講者：文字`），模型只回行號；存下的原話與講者一律取那個片段本身，模型寫不出不存在的話。
- 打斷的候選由程式先挑：換了講者、而且離上一位講者停下不到 `INTERRUPTION_GAP_SECONDS`（或重疊）。模型只能從候選裡選，選了別的丟掉。

結果是估計（畫面上這樣標示）。少於兩位講者時沒什麼好分析，不呼叫模型。"""

import logging
from dataclasses import dataclass

from app.services.agent_tools import timed_line
from app.services.chapter_generator import parse_json_reply
from app.services.llm_client import ChatModel, chat
from app.services.speaker_context import speaker_names, spoken_segments
from app.services.usage_meter import UsageMeter

logger = logging.getLogger(__name__)

INTERRUPTION_GAP_SECONDS = 0.3
_MAX_TOKENS = 1200

_PROMPT_TEMPLATE = (
    "以下是一段多人錄音的逐字稿，每行是「[行號] [分:秒] 講者：說的話」。逐字稿是語音辨識的結果，幾乎沒有標點。\n"
    "請判斷兩件事，都只回行號：\n"
    "1. questions：哪幾行是講者在**向其他人提問**（真的想得到回答的問題，包括沒有問號的問句）。自問自答、反問句、引述別人的問題都不算。\n"
    "2. interruptions：下面列出的「可能的打斷」是換人時間隔很短的地方。請判斷哪些行是那位講者**在上一位還沒講完時插話**"
    "（上一行的話明顯沒說完、被截斷）；上一位已經講完、自然輪到下一位的不算。只能從列出的行號裡選。\n"
    '只回傳 JSON：{{"questions": [行號, ...], "interruptions": [行號, ...]}}，沒有就給空陣列。不要其他文字。\n\n'
    "可能的打斷：{candidates}\n\n{lines}"
)


class InsightFormatError(Exception):
    """模型回的不是預期的 JSON。"""


@dataclass(frozen=True)
class Line:
    """交給模型的一行：有內容、有講者的片段，從 1 編號。"""

    number: int
    start_time: float
    end_time: float
    speaker_label: str
    text: str


@dataclass(frozen=True)
class Insight:
    kind: str  # "question" / "interruption"
    speaker_label: str
    # 打斷時被打斷的講者；問題是 None。
    interrupted_label: str | None
    start_time: float
    text: str


def numbered_segments(transcript) -> list[Line]:
    lines = [s for s in spoken_segments(transcript) if s.speaker_label]
    return [Line(n, float(s.start_time), float(s.end_time), s.speaker_label, s.text) for n, s in enumerate(lines, start=1)]


def interruption_candidates(lines: list[Line]) -> list[int]:
    """可能的打斷：換了講者、離上一位停下不到 INTERRUPTION_GAP_SECONDS（重疊也算）的行號。"""
    return [
        line.number for previous, line in zip(lines, lines[1:])
        if line.speaker_label != previous.speaker_label and line.start_time - previous.end_time <= INTERRUPTION_GAP_SECONDS
    ]


def analyze_speakers(transcript, *, model: ChatModel, meter: UsageMeter | None) -> list[Insight]:
    """兩位以上講者時請模型判斷問題與打斷，依時間排序（同一行的問題排在打斷前）。模型呼叫失敗讓例外往外冒（呼叫端決定重試）；
    回的格式不對 raise InsightFormatError。"""
    names = speaker_names(transcript)
    if names is None:
        return []
    lines = numbered_segments(transcript)
    candidates = interruption_candidates(lines)
    prompt = _PROMPT_TEMPLATE.format(
        candidates="、".join(f"第 {n} 行" for n in candidates) or "（沒有）",
        lines="\n".join(f"[{line.number}] {timed_line(line.start_time, names.get(line.speaker_label), line.text)}"
                        for line in lines),
    )
    reply = chat(model, [{"role": "user", "content": prompt}], max_tokens=_MAX_TOKENS, meter=meter)
    try:
        data = parse_json_reply(reply.text)
    except ValueError as exc:
        raise InsightFormatError("not JSON") from exc
    if not isinstance(data, dict) or not all(isinstance(data.get(key, []), list) for key in ("questions", "interruptions")):
        raise InsightFormatError("not {questions: [...], interruptions: [...]}")

    by_number = {line.number: line for line in lines}
    insights = [
        Insight("question", line.speaker_label, None, line.start_time, line.text)
        for line in _lines(data.get("questions", []), by_number)
    ]
    allowed = set(candidates)
    insights += [
        Insight("interruption", line.speaker_label, by_number[line.number - 1].speaker_label, line.start_time, line.text)
        for line in _lines(data.get("interruptions", []), by_number) if line.number in allowed
    ]
    return sorted(insights, key=lambda insight: (insight.start_time, insight.kind != "question"))


def _lines(numbers: list, by_number: dict[int, Line]) -> list[Line]:
    """模型給的行號裡真的存在的那幾行，各一次。"""
    seen: list[Line] = []
    for number in numbers:
        line = by_number.get(number) if isinstance(number, int) and not isinstance(number, bool) else None
        if line is not None and line not in seen:
            seen.append(line)
    return seen
