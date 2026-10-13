"""判斷一條主張的查核結論（見 CONTEXT.md「查核」）：把搜到的網頁摘錄編號交給模型，**只能根據這些摘錄**給結論——有依據、有出入、查不到
可靠來源——說明要標出引用的編號。程式再把關：引用的編號要是給它看的網頁；說有依據或有出入卻沒有引用任何一個，就當成查不到可靠來源。
搜尋沒有結果時不用問模型（呼叫端處理）。"""

import json
import re
from dataclasses import dataclass

from app.models import Verdict
from app.services.chapter_generator import parse_json_reply
from app.services.llm_client import ChatModel, chat
from app.services.traditional_chinese import to_traditional
from app.services.usage_meter import UsageMeter
from app.services.web_search import WebPage

_MAX_TOKENS = 800
_MAX_EXPLANATION_CHARS = 600
# 查核給的結論；無法查核是標出主張時決定的，不在這裡。
_VERDICTS = (Verdict.SUPPORTED, Verdict.DISPUTED, Verdict.NO_RELIABLE_SOURCE)
UNSUPPORTED_EXPLANATION = "搜到的網頁沒有足夠可靠的依據可以判斷這條主張。"
NOTHING_FOUND_EXPLANATION = "網路搜尋沒有找到相關的網頁。"
_CITATION = re.compile(r"(\s?)\[(\d+)\]")

_PROMPT_TEMPLATE = (
    "請查核下面這條主張。你**只能根據**下面列出的網頁摘錄判斷（每個以 [編號] 標示），不要用你自己知道的事。\n"
    "結論（verdict）只能是：\n"
    "- supported：摘錄明確支持這條主張；\n"
    "- disputed：摘錄的說法跟主張不一樣（例如數字、年份、對象不同）——說明裡寫出摘錄的說法跟主張差在哪裡；\n"
    "- no_reliable_source：摘錄沒有足夠可靠的依據可以判斷。\n"
    "explanation 用台灣慣用的繁體中文寫 1 到 3 句，每個依據的句子後面標出摘錄的編號，例如 [1]；不要把摘錄說成是錄音裡講的。\n"
    "sources 是你引用的摘錄編號。\n"
    '只回傳 JSON：{{"verdict": "...", "explanation": "...", "sources": [編號, ...]}}，不要其他文字。\n\n'
    "## 主張\n{claim}\n\n## 網頁摘錄\n{pages}"
)


class JudgeFormatError(Exception):
    """模型回的不是預期的 JSON。"""


@dataclass(frozen=True)
class Judgement:
    verdict: Verdict  # supported / disputed / no_reliable_source
    explanation: str
    # 引用的網頁（照引用的順序）：{title, url, excerpt}
    sources: list[dict]


def judge_claim(claim: str, pages: list[WebPage], *, model: ChatModel, meter: UsageMeter | None) -> Judgement:
    """依搜到的網頁判斷一條主張。模型呼叫失敗讓例外往外冒；回的不是預期的 JSON raise JudgeFormatError。"""
    listed = "\n\n".join(f"[{n}] {page.source.title}（{page.site}）\n{page.content}" for n, page in enumerate(pages, start=1))
    reply = chat(model, [{"role": "user", "content": _PROMPT_TEMPLATE.format(claim=claim, pages=listed)}],
                 max_tokens=_MAX_TOKENS, meter=meter)
    try:
        data = parse_json_reply(reply.text)
    except ValueError as exc:
        raise JudgeFormatError("not JSON") from exc
    if not isinstance(data, dict) or data.get("verdict") not in _VERDICTS or not isinstance(data.get("explanation"), str):
        raise JudgeFormatError(f"not a judgement: {json.dumps(data, ensure_ascii=False)[:200]}")
    cited = [n for n in data.get("sources") or [] if isinstance(n, int) and not isinstance(n, bool) and 1 <= n <= len(pages)]
    cited = list(dict.fromkeys(cited))
    verdict = Verdict(data["verdict"])
    if verdict != Verdict.NO_RELIABLE_SOURCE and not cited:
        # A conclusion must rest on one of the pages it was shown; its explanation, with nothing cited, can't stand either.
        return Judgement(verdict=Verdict.NO_RELIABLE_SOURCE, explanation=UNSUPPORTED_EXPLANATION, sources=[])
    explanation, cited = _renumber(to_traditional(data["explanation"].strip()), cited)
    sources = [{"title": pages[n - 1].source.title, "url": pages[n - 1].source.url, "excerpt": pages[n - 1].content}
               for n in cited]
    return Judgement(verdict=verdict, explanation=explanation[:_MAX_EXPLANATION_CHARS].strip(), sources=sources)


def _renumber(explanation: str, cited: list[int]) -> tuple[str, list[int]]:
    """只保存引用的網頁，所以說明裡的 [n] 改成它在保存的來源裡的位置（依說明裡第一次出現的順序，說明沒提到的接在後面）；指到沒引用的網頁
    的 [n] 拿掉。"""
    in_text = [int(n) for _, n in _CITATION.findall(explanation) if int(n) in cited]
    order = list(dict.fromkeys(in_text + cited))
    place = {n: i for i, n in enumerate(order, start=1)}

    def replace(match: re.Match) -> str:
        n = int(match.group(2))
        return f"{match.group(1)}[{place[n]}]" if n in place else ""

    return _CITATION.sub(replace, explanation), order
