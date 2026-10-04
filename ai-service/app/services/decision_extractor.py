"""抽出一場會議或訪談的決策（見 CONTEXT.md「決策」「暫定」、.scratch/decision-log）：請模型讀摘要、章節與有行號的逐字稿（每行
`[行號] [分:秒] 講者：文字`），列出與會者**做成**的決定——決定了什麼、為什麼、考慮過但沒選的、誰提出或拍板、是不是暫定。

模型寫得出不存在的話，所以每個決策要附做成決定的那一行的行號與照抄的原話，程式驗證原話真的在那一行或前後一行（正規化後比對），
對不上的整筆丟掉——寧可漏，也不要編。存下的原話與時間點一律取那個片段本身。提出者對不上講者只是不知道是誰，不丟整筆。"""

import logging
from dataclasses import dataclass

from app.services.agent_tools import normalize_text, timed_line
from app.services.chapter_generator import parse_json_reply
from app.services.llm_client import ChatModel, chat
from app.services.segment_times import clock
from app.services.speaker_context import speaker_names, spoken_segments
from app.services.traditional_chinese import to_traditional
from app.services.usage_meter import UsageMeter

logger = logging.getLogger(__name__)

_MAX_TOKENS = 3000
_MAX_DECISIONS = 30
_MAX_STATEMENT_CHARS = 300
_MAX_RATIONALE_CHARS = 1000
_MAX_ALTERNATIVES = 10
_MAX_ALTERNATIVE_CHARS = 200
# 原話可以在模型說的那一行，或前後這幾行（一句話常被語音辨識切成兩段）。
_QUOTE_WINDOW = 1

_PROMPT_TEMPLATE = (
    "以下是一場會議或訪談的摘要、章節與逐字稿。逐字稿每行是「[行號] [分:秒] 講者：說的話」，是語音辨識的結果，可能有錯字、幾乎沒有標點。\n"
    "請找出與會者在這場**做成的決定**：大家同意、有人拍板、說「就這樣」「那我們用 X」的事。提議、還在討論、個人意見、"
    "某人要去做的待辦事項都**不算**。沒有把握就不要列。\n"
    "每個決定：\n"
    "- statement：決定了什麼，一句話，用台灣慣用的繁體中文；專有名詞保留原文。\n"
    "- rationale：為什麼這樣決定，只寫錄音裡講到的理由；沒講就空字串，不要自己推測。\n"
    "- alternatives：考慮過但沒選的選項；沒有就 []。\n"
    "- proposed_by：提出或拍板的講者，照逐字稿寫的名稱（例如「講者 2」）；看不出來就 null。\n"
    "- tentative：明確說了之後還要再確認的（例如「先這樣，下週再確認」）是 true，否則 false。\n"
    "- line：做成這個決定的那一行的行號；quote：從那一行**照抄**一小段原話（5 到 30 個字，不要翻譯）。\n"
    '只回傳 JSON 陣列，例如 [{{"statement": "...", "rationale": "...", "alternatives": ["..."], "proposed_by": "講者 2", '
    '"tentative": false, "line": 12, "quote": "..."}}]；沒有任何決定就回 []。不要其他文字。\n\n'
    "## 摘要\n{summary}\n\n## 章節\n{chapters}\n\n## 逐字稿\n{lines}"
)


class DecisionFormatError(Exception):
    """模型回的不是 JSON 陣列。"""


@dataclass(frozen=True)
class ExtractedDecision:
    statement: str
    rationale: str  # 沒講就是空字串
    alternatives: list[str]
    proposed_by: str | None  # 講者標籤；看不出來或對不上是 None
    tentative: bool
    start_time: float
    evidence_text: str  # 做成決定的那個片段的文字


@dataclass(frozen=True)
class _Line:
    number: int
    start_time: float
    speaker_label: str | None
    text: str


def extract_decisions(transcript, summary: str, chapters: list[tuple[str, float]], *, model: ChatModel,
                      meter: UsageMeter | None) -> list[ExtractedDecision]:
    """抽出對得上錄音的決策（依時間排序）。模型呼叫失敗讓例外往外冒（呼叫端決定重試）；回的不是 JSON 陣列 raise DecisionFormatError。"""
    names = speaker_names(transcript)
    lines = [_Line(n, float(s.start_time), s.speaker_label or None, s.text)
             for n, s in enumerate(spoken_segments(transcript), start=1)]
    numbered = "\n".join(
        f"[{line.number}] {timed_line(line.start_time, names.get(line.speaker_label) if names else None, line.text)}"
        for line in lines)
    chapter_lines = "\n".join(f"[{clock(start)}] {title}" for title, start in chapters) or "（沒有章節）"
    prompt = _PROMPT_TEMPLATE.format(summary=summary or "（沒有摘要）", chapters=chapter_lines, lines=numbered)
    reply = chat(model, [{"role": "user", "content": prompt}], max_tokens=_MAX_TOKENS, meter=meter)
    try:
        data = parse_json_reply(reply.text)
    except ValueError as exc:
        raise DecisionFormatError("not JSON") from exc
    if not isinstance(data, list):
        raise DecisionFormatError("not a JSON array")
    labels = {name: label for label, name in names.items()} if names else {}
    decisions = [d for item in data[:_MAX_DECISIONS] if (d := _grounded(item, lines, labels))]
    dropped = min(len(data), _MAX_DECISIONS) - len(decisions)
    if dropped:
        logger.info("dropped %d decisions the recording doesn't back up", dropped)
    return sorted(decisions, key=lambda d: d.start_time)


def _grounded(item: object, lines: list[_Line], labels: dict[str, str]) -> ExtractedDecision | None:
    if not isinstance(item, dict):
        return None
    number, quote, statement = item.get("line"), item.get("quote"), item.get("statement")
    if not isinstance(number, int) or isinstance(number, bool) or not 1 <= number <= len(lines):
        return None
    if not isinstance(statement, str) or not statement.strip() or not isinstance(quote, str):
        return None
    wanted = normalize_text(quote)
    nearby = lines[max(0, number - 1 - _QUOTE_WINDOW):number + _QUOTE_WINDOW]
    if not wanted or not any(wanted in normalize_text(line.text) for line in nearby):
        return None
    line = lines[number - 1]
    rationale = item.get("rationale")
    alternatives = item.get("alternatives")
    proposed_by = item.get("proposed_by")
    return ExtractedDecision(
        statement=_text(statement, _MAX_STATEMENT_CHARS),
        rationale=_text(rationale, _MAX_RATIONALE_CHARS) if isinstance(rationale, str) else "",
        alternatives=[_text(a, _MAX_ALTERNATIVE_CHARS) for a in alternatives if isinstance(a, str) and a.strip()][
            :_MAX_ALTERNATIVES] if isinstance(alternatives, list) else [],
        proposed_by=labels.get(proposed_by.strip()) if isinstance(proposed_by, str) else None,
        tentative=item.get("tentative") is True,
        start_time=line.start_time,
        evidence_text=line.text,
    )


def _text(value: str, limit: int) -> str:
    return to_traditional(value.strip())[:limit].strip()
