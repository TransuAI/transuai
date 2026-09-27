"""會後處理 agent 的工具（見 CONTEXT.md「會後處理」）。每個工具是一份設定：名稱、說明、參數、讀取類還是寫入類。
讀取類真的執行、結果回給模型；寫入類不執行，只驗證參數後記成行動提案（見 docs/adr/0007）。沒列在這裡的工具 agent 看不到。"""

import json
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any

from app.services.google_calendar import CalendarError, create_event, list_events


class ToolKind(StrEnum):
    READ = "read"
    WRITE = "write"


class ToolArgumentError(Exception):
    """參數不對；錯誤訊息回給模型，讓它改正。"""


class ToolFailed(Exception):
    """讀取類工具執行失敗（例如 Google 日曆連不上）；訊息回給模型。"""


@dataclass(frozen=True)
class AgentTool:
    name: str
    description: str
    parameters: dict[str, Any]
    kind: ToolKind
    progress: str  # 執行時給使用者看的進度文字
    # 讀取類：執行並回傳結果。寫入類：驗證並回傳要記成提案的參數。
    handle: Callable[[dict[str, Any]], Any]
    service: str | None = None  # 寫入類：哪個外部服務
    proposal_kind: str | None = None  # 寫入類：哪一種提案（決定前端的表單）
    # 寫入類：使用者確認後，用（已經過 handle 驗證的）最終參數真的執行，回傳建立好的項目的網址；失敗 raise ToolFailed。
    execute: Callable[[dict[str, Any]], str] | None = None

    def schema(self) -> dict[str, Any]:
        return {"type": "function", "function": {"name": self.name, "description": self.description,
                                                 "parameters": self.parameters}}


def _object(properties: dict[str, Any], required: list[str]) -> dict[str, Any]:
    return {"type": "object", "properties": properties, "required": required}


_ISO = "ISO 8601，要含時區，例如 2026-11-18T14:00:00+08:00"


def text_argument(args: dict[str, Any], name: str, *, required: bool = True) -> str | None:
    value = args.get(name)
    if value is None and not required:
        return None
    if not isinstance(value, str) or not value.strip():
        raise ToolArgumentError(f"{name} 要是非空的文字")
    return value.strip()


def time_argument(args: dict[str, Any], name: str) -> datetime:
    value = args.get(name)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00")) if isinstance(value, str) else None
    except ValueError:
        parsed = None
    if parsed is None or parsed.tzinfo is None:
        raise ToolArgumentError(f"{name} 要是{_ISO}")
    return parsed


# --- 這個 Job 的內部工具（讀取類） ---


@dataclass(frozen=True)
class JobContent:
    summary: str | None
    chapters: list[tuple[str, float]]
    # (開始秒數, 講者目前的名字或 None, 文字)，已清空片段不在裡面
    lines: list[tuple[float, str | None, str]]
    speakers: list[str]


def _clock(seconds: float) -> str:
    minutes, secs = divmod(int(seconds), 60)
    return f"{minutes:02d}:{secs:02d}"


def _normalize(text: str) -> str:
    """比對用：全形轉半形、小寫、去掉空白與標點。"""
    folded = unicodedata.normalize("NFKC", text).lower()
    return "".join(ch for ch in folded if not (ch.isspace() or unicodedata.category(ch)[0] in "PS"))


def _bigrams(text: str) -> set[str]:
    return {text[i:i + 2] for i in range(len(text) - 1)} or {text}


def search_lines(lines: list[tuple[float, str | None, str]], query: str, *, limit: int = 8) -> list[str]:
    """關鍵字（空白分隔）出現在片段裡的片段；語音辨識常把字拆開或寫法不同（「3月24日」寫成「3月24上午」），找不到完全
    相同的就改用雙字重疊的比例（至少 3/4）。"""
    terms = [_normalize(term) for term in query.split() if _normalize(term)]
    if not terms:
        raise ToolArgumentError("query 要有關鍵字")
    scored = []
    for start, speaker, text in lines:
        normalized = _normalize(text)
        score = max(1.0 if term in normalized else
                    len(_bigrams(term) & _bigrams(normalized)) / len(_bigrams(term)) for term in terms)
        if score >= 0.75:
            scored.append((score, start, speaker, text))
    scored.sort(key=lambda item: (-item[0], item[1]))
    return [f"[{_clock(start)}] {speaker + '：' if speaker else ''}{text}" for _, start, speaker, text in scored[:limit]]


def job_tools(content: JobContent) -> list[AgentTool]:
    def search(args: dict[str, Any]) -> Any:
        return search_lines(content.lines, text_argument(args, "query") or "") or "沒有找到符合的片段"

    return [
        AgentTool("get_summary", "讀這場會議的摘要。", _object({}, []), ToolKind.READ, "正在閱讀摘要…",
                  lambda _args: content.summary or "還沒有摘要"),
        AgentTool("get_chapters", "讀這場會議的章節（標題與開始時間）。", _object({}, []), ToolKind.READ, "正在閱讀章節…",
                  lambda _args: [{"title": title, "start": _clock(start)} for title, start in content.chapters]),
        AgentTool("search_transcript", "用關鍵字搜尋逐字稿片段，回傳符合的片段（時間、講者、文字）。逐字稿是語音辨識的結果，"
                  "可能有錯字。", _object({"query": {"type": "string", "description": "關鍵字，可以用空白分隔多個"}}, ["query"]),
                  ToolKind.READ, "正在搜尋逐字稿…", search),
        AgentTool("list_speakers", "列出講者與他們目前的名字。", _object({}, []), ToolKind.READ, "正在確認講者…",
                  lambda _args: content.speakers or "只有一位講者"),
    ]


# --- Google 日曆 ---


def calendar_tools(access_token: Callable[[], str]) -> list[AgentTool]:
    def events(args: dict[str, Any]) -> Any:
        start, end = time_argument(args, "time_min"), time_argument(args, "time_max")
        if end <= start:
            raise ToolArgumentError("time_max 要晚於 time_min")
        try:
            return list_events(access_token(), args["time_min"], args["time_max"]) or "這段時間沒有行程"
        except CalendarError as exc:
            raise ToolFailed(str(exc)) from exc

    def event_proposal(args: dict[str, Any]) -> dict[str, Any]:
        summary = text_argument(args, "summary")
        start, end = time_argument(args, "start"), time_argument(args, "end")
        if end <= start:
            raise ToolArgumentError("end 要晚於 start")
        description = text_argument(args, "description", required=False)
        return {"summary": summary, "start": args["start"], "end": args["end"],
                **({"description": description} if description else {})}

    def create(args: dict[str, Any]) -> str:
        try:
            return create_event(access_token(), args["summary"], args["start"], args["end"], args.get("description"))
        except CalendarError as exc:
            raise ToolFailed(str(exc)) from exc

    return [
        AgentTool("calendar_list_events", "（Google 日曆，讀取）列出使用者某段時間內的行程，用來找空檔。", _object({
            "time_min": {"type": "string", "description": _ISO}, "time_max": {"type": "string", "description": _ISO}},
            ["time_min", "time_max"]), ToolKind.READ, "正在查詢你的行事曆…", events),
        AgentTool("calendar_create_event", "（Google 日曆，寫入）建立一個行事曆活動，例如下次會議。只會記成提案，等使用者確認。",
                  _object({"summary": {"type": "string"}, "start": {"type": "string", "description": _ISO},
                           "end": {"type": "string", "description": _ISO}, "description": {"type": "string"}},
                          ["summary", "start", "end"]),
                  ToolKind.WRITE, "正在整理行動提案…", event_proposal, service="google_calendar",
                  proposal_kind="calendar_event", execute=create),
    ]


def result_text(result: Any) -> str:
    return result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)


