"""標出可以查核的主張（見 CONTEXT.md「主張」、.scratch/fact-check）：請模型讀有行號的逐字稿（每行 `[行號] [分:秒] 講者：文字`），
列出數字、統計、關於外部世界的事實陳述——不含意見、預測；只有說話者自己知道的事（親身經歷、自己的感受）標成不能查核。每條主張
整理成一句完整、可以拿去搜尋的陳述（補上主詞、時間、地點）。

跟決策一樣，每條要附那一行的行號與照抄的原話，程式驗證原話真的在那一行或前後一行，對不上的整筆丟掉。存下的原話、時間點與講者
一律取那個片段本身。不花搜尋次數：這一步只標出來，要不要查由使用者勾選（見 fact_checks.py）。"""

import logging
from dataclasses import dataclass

from app.services.agent_tools import normalize_text, timed_line
from app.services.chapter_generator import parse_json_reply
from app.services.llm_client import ChatModel, chat
from app.services.speaker_context import speaker_names, spoken_segments
from app.services.traditional_chinese import to_traditional
from app.services.usage_meter import UsageMeter

logger = logging.getLogger(__name__)

KINDS = ("number", "fact")
_MAX_TOKENS = 3000
_MAX_CLAIMS = 40
_MAX_CLAIM_CHARS = 300
# 原話可以在模型說的那一行，或前後這幾行（一句話常被語音辨識切成兩段）。
_QUOTE_WINDOW = 1

_PROMPT_TEMPLATE = (
    "以下是一段錄音（可能是演講、Podcast、訪談或會議）的逐字稿，每行是「[行號] [分:秒] 講者：說的話」，是語音辨識的結果，"
    "可能有錯字、幾乎沒有標點。\n"
    "請找出可以拿外部資料查核的**主張**：\n"
    "- number：數字、統計、比例、金額、日期（例如「台灣有三成的人…」「去年營收成長 20%」）。\n"
    "- fact：關於外部世界的事實陳述（例如「這個法規去年改了」「某公司是某年成立的」）。\n"
    "意見、評價、預測、建議、問題都**不算**。只有說話者自己知道的事（親身經歷、自己的感受、自己公司內部的事）可以列出，但 checkable 給 false。\n"
    "每條主張：\n"
    "- claim：整理成一句完整、可以拿去網路搜尋的陳述，用台灣慣用的繁體中文；補上錄音裡提到的主詞、時間、地點，不要加錄音裡沒說的內容。\n"
    "- kind：number 或 fact。\n"
    "- checkable：能不能拿外部資料查核（true / false）。\n"
    "- line：說這句話的那一行的行號；quote：從那一行**照抄**一小段原話（5 到 30 個字，不要翻譯）。\n"
    "沒有把握就不要列。\n"
    '只回傳 JSON 陣列，例如 [{{"claim": "...", "kind": "number", "checkable": true, "line": 12, "quote": "..."}}]；'
    "沒有任何主張就回 []。不要其他文字。\n\n{lines}"
)


class ClaimFormatError(Exception):
    """模型回的不是 JSON 陣列。"""


@dataclass(frozen=True)
class ExtractedClaim:
    claim: str
    kind: str  # number / fact
    checkable: bool
    speaker_label: str | None
    start_time: float
    text: str  # 說這句話的那個片段的文字


@dataclass(frozen=True)
class _Line:
    number: int
    start_time: float
    speaker_label: str | None
    text: str


def extract_claims(transcript, *, model: ChatModel, meter: UsageMeter | None) -> list[ExtractedClaim]:
    """標出對得上錄音的主張（依時間排序）。模型呼叫失敗讓例外往外冒（呼叫端決定重試）；回的不是 JSON 陣列 raise ClaimFormatError。"""
    names = speaker_names(transcript)
    lines = [_Line(n, float(s.start_time), s.speaker_label or None, s.text)
             for n, s in enumerate(spoken_segments(transcript), start=1)]
    numbered = "\n".join(
        f"[{line.number}] {timed_line(line.start_time, names.get(line.speaker_label) if names else None, line.text)}"
        for line in lines)
    reply = chat(model, [{"role": "user", "content": _PROMPT_TEMPLATE.format(lines=numbered)}],
                 max_tokens=_MAX_TOKENS, meter=meter)
    try:
        data = parse_json_reply(reply.text)
    except ValueError as exc:
        raise ClaimFormatError("not JSON") from exc
    if not isinstance(data, list):
        raise ClaimFormatError("not a JSON array")
    claims = [c for item in data[:_MAX_CLAIMS] if (c := _grounded(item, lines))]
    dropped = min(len(data), _MAX_CLAIMS) - len(claims)
    if dropped:
        logger.info("dropped %d claims the recording doesn't back up", dropped)
    return sorted(claims, key=lambda c: c.start_time)


def _grounded(item: object, lines: list[_Line]) -> ExtractedClaim | None:
    if not isinstance(item, dict):
        return None
    number, quote, claim, kind = item.get("line"), item.get("quote"), item.get("claim"), item.get("kind")
    if not isinstance(number, int) or isinstance(number, bool) or not 1 <= number <= len(lines):
        return None
    if not isinstance(claim, str) or not claim.strip() or kind not in KINDS or not isinstance(quote, str):
        return None
    wanted = normalize_text(quote)
    nearby = lines[max(0, number - 1 - _QUOTE_WINDOW):number + _QUOTE_WINDOW]
    if not wanted or not any(wanted in normalize_text(line.text) for line in nearby):
        return None
    line = lines[number - 1]
    return ExtractedClaim(claim=to_traditional(claim.strip())[:_MAX_CLAIM_CHARS].strip(), kind=kind,
                          checkable=item.get("checkable") is not False, speaker_label=line.speaker_label,
                          start_time=line.start_time, text=line.text)
