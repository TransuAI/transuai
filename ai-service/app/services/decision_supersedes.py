"""取代（見 CONTEXT.md「取代」）：抽出一場的決策之後，替每個新的決策找這位使用者**較早的會議**裡意思相近的決策當候選（找候選見
decisions.py），請模型判斷新的決策是不是改變、推翻了其中一個。模型只能指向給它看的候選之一，其他的都不收。

候選用代號（A、B、C）而不是 id 交給模型；回的對不上就當沒有取代。整個判斷失敗由呼叫端處理（決策照樣存，只是沒有連結）。"""

import uuid
from dataclasses import dataclass
from datetime import datetime

from app.services.chapter_generator import parse_json_reply
from app.services.llm_client import ChatModel, chat
from app.services.usage_meter import UsageMeter

_MAX_TOKENS = 800
_CODES = "ABCDEFGHIJ"

_PROMPT_TEMPLATE = (
    "以下是一場會議剛做成的決策（新的，以編號標示）。每個新的決策下面列出同一位使用者在**更早的會議**做過、主題相近的決策"
    "（舊的，以代號 A、B、C 標示，括號裡是那場會議的日期）。\n"
    "請判斷每個新的決策是不是**取代**了其中一個舊的：改變、推翻或修正了那個舊決定（例如舊的是「資料庫用 MySQL」，新的是"
    "「資料庫改用 PostgreSQL」）。只是主題相同、延續舊決定、補充細節，或兩個可以同時成立的，都**不算**取代。沒有把握就當不算。\n"
    '只回傳 JSON 陣列，每個新的決策一筆：{{"decision": 編號, "supersedes": "代號"}}，不算取代就是 {{"decision": 編號, '
    '"supersedes": null}}。不要其他文字。\n\n{decisions}'
)


@dataclass(frozen=True)
class NewDecision:
    statement: str
    rationale: str


@dataclass(frozen=True)
class Candidate:
    id: uuid.UUID
    statement: str
    rationale: str
    meeting_at: datetime


def judge_supersedes(decisions: list[NewDecision], candidates: list[list[Candidate]], *, model: ChatModel,
                     meter: UsageMeter | None) -> list[uuid.UUID | None]:
    """每個新的決策取代了哪一個候選（沒有就是 None），跟 decisions 同順序。沒有任何候選就不呼叫模型。模型呼叫失敗讓例外往外冒；回的不是
    預期的 JSON raise ValueError。"""
    if not any(candidates):
        return [None] * len(decisions)
    blocks = []
    for n, (decision, offered) in enumerate(zip(decisions, candidates), start=1):
        if not offered:
            continue
        lines = [f"[{n}] 新的：{_described(decision.statement, decision.rationale)}"]
        lines += [f"    {code}. （{c.meeting_at.date().isoformat()}）{_described(c.statement, c.rationale)}"
                  for code, c in zip(_CODES, offered)]
        blocks.append("\n".join(lines))
    reply = chat(model, [{"role": "user", "content": _PROMPT_TEMPLATE.format(decisions="\n\n".join(blocks))}],
                 max_tokens=_MAX_TOKENS, meter=meter)
    data = parse_json_reply(reply.text)
    if not isinstance(data, list):
        raise ValueError("the supersedes answer is not a JSON array")
    chosen: list[uuid.UUID | None] = [None] * len(decisions)
    for item in data:
        if not isinstance(item, dict) or not isinstance(item.get("decision"), int):
            continue
        n, code = item["decision"], item.get("supersedes")
        if not 1 <= n <= len(decisions) or not isinstance(code, str):
            continue
        offered = candidates[n - 1]
        index = _CODES.find(code.strip().upper()) if len(code.strip()) == 1 else -1
        if 0 <= index < len(offered):  # only one of the decisions it was shown
            chosen[n - 1] = offered[index].id
    return chosen


def _described(statement: str, rationale: str) -> str:
    return f"{statement}（理由：{rationale}）" if rationale else statement
