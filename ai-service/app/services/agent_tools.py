"""會後處理 agent 的工具（見 CONTEXT.md「會後處理」）。每個工具是一份設定：名稱、說明、參數、讀取類還是寫入類。
讀取類真的執行、結果回給模型；寫入類不執行，只驗證參數後記成行動提案（見 docs/adr/0007）。沒列在這裡的工具 agent 看不到。"""

import json
import re
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from enum import StrEnum
from typing import Any

from app.services.gmail import GmailError, create_draft
from app.services.notion import NotionError, call_tool, url_of
from app.services.post_meeting_settings import NotionLocation
from app.services.google_calendar import CalendarError, create_event, list_events
from app.services.google_tasks import TasksError, create_task, list_open_tasks


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
    # 寫入類：使用者確認後，用（已經過 confirm 驗證的）最終參數真的執行，回傳建立好的項目的網址；失敗 raise ToolFailed。
    execute: Callable[[dict[str, Any]], str] | None = None
    # 寫入類：驗證使用者確認的最終參數；沒有就跟模型提案時一樣用 handle。使用者可以填模型不能填的欄位（例如收件人）。
    check_confirmed: Callable[[dict[str, Any]], dict[str, Any]] | None = None

    def validate_confirmed(self, args: dict[str, Any]) -> dict[str, Any]:
        return (self.check_confirmed or self.handle)(args)

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


def normalize_text(text: str) -> str:
    """比對用：全形轉半形、小寫、去掉空白與標點。"""
    folded = unicodedata.normalize("NFKC", text).lower()
    return "".join(ch for ch in folded if not (ch.isspace() or unicodedata.category(ch)[0] in "PS"))


def _bigrams(text: str) -> set[str]:
    return {text[i:i + 2] for i in range(len(text) - 1)} or {text}


# 模型給的「依據的錄音時間」要對得到有人講話的地方：本機模型常填 00:00、上傳時間，或照抄說明裡的範例（ADR 0011）。
_TIME_TOLERANCE_SECONDS = 3


def _seconds(clock: str) -> float | None:
    """「12:34」或「1:02:03」→ 秒數；不是時間就是 None。"""
    parts = clock.strip().split(":")
    if not 2 <= len(parts) <= 3 or not all(part.isdigit() for part in parts):
        return None
    seconds = 0
    for part in parts:
        seconds = seconds * 60 + int(part)
    return float(seconds)


@dataclass(frozen=True)
class Grounding:
    """模型提案時檢查待辦的依據時間與期限：本機模型常編（ADR 0011）——時間填 00:00、上傳時間或範例，期限寫錯年份或早於
    會議。對不到的就不留（留空讓使用者自己填）。使用者確認的值不檢查，所以執行時不給 Grounding。"""

    spoken: Callable[[str], bool]  # 這個「分:秒」附近有沒有一句話開始
    plausible_due: Callable[[str], bool]  # 這個期限（YYYY-MM-DD）是不是在會議當天到一年後之間


def grounding_for(lines: list[tuple[float, str | None, str]], meeting_day: date) -> Grounding:
    starts = [start for start, _speaker, _text in lines]

    def spoken(clock: str) -> bool:
        seconds = _seconds(clock)
        return seconds is not None and any(abs(start - seconds) <= _TIME_TOLERANCE_SECONDS for start in starts)

    def plausible_due(due: str) -> bool:
        return meeting_day <= date.fromisoformat(due) <= meeting_day + timedelta(days=366)

    return Grounding(spoken, plausible_due)


def search_lines(lines: list[tuple[float, str | None, str]], query: str, *, limit: int = 8) -> list[str]:
    """關鍵字（空白分隔）出現在片段裡的片段；語音辨識常把字拆開或寫法不同（「3月24日」寫成「3月24上午」），找不到完全
    相同的就改用雙字重疊的比例（至少 3/4）。"""
    terms = [normalize_text(term) for term in query.split() if normalize_text(term)]
    if not terms:
        raise ToolArgumentError("query 要有關鍵字")
    scored = []
    for start, speaker, text in lines:
        normalized = normalize_text(text)
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


# --- Gmail（只有建立草稿） ---

# A plain address only: no display names, quotes, brackets or commas (a comma would make it two addresses in To).
_EMAIL = re.compile(r"[^@\s,;:<>()\[\]\"]+@[^@\s,;:<>()\[\]\"]+\.[^@\s,;:<>()\[\]\"]+")


def gmail_tools(access_token: Callable[[], str]) -> list[AgentTool]:
    def draft_proposal(args: dict[str, Any]) -> dict[str, Any]:
        subject, body = text_argument(args, "subject"), text_argument(args, "body")
        if subject and ("\n" in subject or "\r" in subject):
            raise ToolArgumentError("subject 只能有一行")
        to = args.get("to", [])
        if not isinstance(to, list) or not all(isinstance(address, str) for address in to):
            raise ToolArgumentError("to 要是 email 地址的陣列")
        to = [address.strip() for address in to if address.strip()]
        invalid = [address for address in to if not _EMAIL.fullmatch(address)]
        if invalid:
            raise ToolArgumentError(f"這些不是 email 地址：{'、'.join(invalid)}")
        return {"to": to, "subject": subject, "body": body}

    def create(args: dict[str, Any]) -> str:
        try:
            return create_draft(access_token(), args["to"], args["subject"], args["body"])
        except GmailError as exc:
            raise ToolFailed(str(exc)) from exc

    return [
        AgentTool("gmail_create_draft", "（Gmail，寫入）建立一封 email 草稿，例如會議紀錄；不會寄出。收件人由使用者自己填，"
                  "你只要寫主旨與內文。只會記成提案，等使用者確認。",
                  _object({"subject": {"type": "string"}, "body": {"type": "string", "description": "純文字內文"}},
                          ["subject", "body"]),
                  # The model only writes the subject and body; who it goes to is the user's to fill in.
                  ToolKind.WRITE, "正在整理行動提案…", lambda args: draft_proposal({**args, "to": []}),
                  service="gmail", proposal_kind="email_draft", execute=create, check_confirmed=draft_proposal),
    ]


# --- Google Tasks（Google 沒有官方的 Tasks MCP，自己用 Tasks API 寫的） ---


def _optional_text(args: dict[str, Any], name: str) -> str | None:
    """選填的文字：沒給或空白都是沒有——跟 text_argument(required=False) 不同，空白不算錯（使用者在表單裡清空的欄位送來的是
    空字串）。"""
    value = args.get(name)
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if not isinstance(value, str):
        raise ToolArgumentError(f"{name} 要是文字")
    return value.strip()


def _due_argument(args: dict[str, Any]) -> str | None:
    due = _optional_text(args, "due")
    if due is None:
        return None
    try:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", due):
            raise ValueError
        date.fromisoformat(due)
    except ValueError:
        raise ToolArgumentError("due 要是日期 YYYY-MM-DD，例如 2026-11-20") from None
    return due


def _task_notes(args: dict[str, Any]) -> str:
    """待辦的內容：負責人與依據的時間戳放在最前面（Google Tasks 沒有這兩個欄位），再接模型或使用者寫的內容。"""
    header = "\n".join(line for line in (
        f"負責人：{args['assignee']}" if args.get("assignee") else "",
        f"依據：錄音 {args['timestamp']}" if args.get("timestamp") else "") if line)
    return "\n\n".join(part for part in (header, args.get("notes") or "") if part)


def _grounded_time(args: dict[str, Any], grounding: Grounding | None) -> str | None:
    """依據的錄音時間；模型提案時（有 grounding）對不到有人講話的地方就不留。"""
    clock = _optional_text(args, "timestamp")
    return None if clock is not None and grounding is not None and not grounding.spoken(clock) else clock


def _grounded_due(args: dict[str, Any], grounding: Grounding | None) -> str | None:
    """期限（格式不對 raise ToolArgumentError）；模型提案時（有 grounding）不在會議當天到一年後之間就不留。"""
    due = _due_argument(args)
    return None if due is not None and grounding is not None and not grounding.plausible_due(due) else due


_TIMESTAMP_RULE = "依據的錄音時間：照抄 search_transcript 結果前面的「分:秒」；沒有找到依據就不要填"


def tasks_tools(access_token: Callable[[], str], grounding: Grounding | None = None) -> list[AgentTool]:
    """grounding：模型提案時檢查依據的時間與期限；執行時（使用者確認的值）不給。"""
    def open_tasks(_args: dict[str, Any]) -> Any:
        try:
            return list_open_tasks(access_token()) or "預設清單裡沒有未完成的待辦"
        except TasksError as exc:
            raise ToolFailed(str(exc)) from exc

    def todo_proposal(args: dict[str, Any]) -> dict[str, Any]:
        proposal = {"title": text_argument(args, "title"), "due": _grounded_due(args, grounding),
                    **{name: _optional_text(args, name) for name in ("notes", "assignee")},
                    "timestamp": _grounded_time(args, grounding)}
        return {name: value for name, value in proposal.items() if value is not None}

    def create(args: dict[str, Any]) -> str:
        try:
            return create_task(access_token(), args["title"], _task_notes(args), args.get("due"))
        except TasksError as exc:
            raise ToolFailed(str(exc)) from exc

    return [
        AgentTool("tasks_list_tasks", "（Google Tasks，讀取）列出使用者預設清單裡還沒完成的待辦（標題、期限），避免重複提出。",
                  _object({}, []), ToolKind.READ, "正在查看你的 Google Tasks…", open_tasks),
        AgentTool("tasks_create_task", "（Google Tasks，寫入）在使用者的 Google Tasks 預設清單建立一個待辦。assignee 填負責的講者"
                  "目前的名字；due 是期限，會議沒講期限就不要填；timestamp 是" + _TIMESTAMP_RULE + "。只會記成提案，等使用者確認。",
                  _object({"title": {"type": "string"}, "notes": {"type": "string", "description": "補充說明"},
                           "assignee": {"type": "string"},
                           "due": {"type": "string", "description": "YYYY-MM-DD，例如 2026-11-20"},
                           "timestamp": {"type": "string", "description": _TIMESTAMP_RULE}}, ["title"]),
                  ToolKind.WRITE, "正在整理行動提案…", todo_proposal, service="google_tasks", proposal_kind="google_task",
                  execute=create),
    ]


# --- Notion（官方遠端 MCP） ---


def _meeting_todos(args: dict[str, Any], grounding: Grounding | None = None) -> list[dict[str, str]]:
    """會議紀錄子頁面裡的待辦：每條標題必填，負責人、期限（YYYY-MM-DD）、依據的錄音時間選填；空白的欄位拿掉。"""
    todos = args.get("todos", [])
    if not isinstance(todos, list) or not all(isinstance(todo, dict) for todo in todos):
        raise ToolArgumentError("todos 要是陣列，每條是 {title, assignee, due, timestamp}")
    checked = []
    for todo in todos:
        item = {"title": text_argument(todo, "title"), "assignee": _optional_text(todo, "assignee"),
                "due": _grounded_due(todo, grounding), "timestamp": _grounded_time(todo, grounding)}
        checked.append({name: value for name, value in item.items() if value is not None})
    return checked


def meeting_page_content(args: dict[str, Any], *, checkboxes: bool) -> str:
    """子頁面的內容：會議紀錄，加上一段「待辦」——待辦放在 Notion 時是打勾清單，放在 Google Tasks 時只是方便閱讀的清單。"""
    lines = []
    for todo in args.get("todos") or []:
        details = "；".join(part for part in (
            f"負責人：{todo['assignee']}" if todo.get("assignee") else "",
            f"期限：{todo['due']}" if todo.get("due") else "",
            f"依據：錄音 {todo['timestamp']}" if todo.get("timestamp") else "") if part)
        lines.append(("- [ ] " if checkboxes else "- ") + todo["title"] + (f"（{details}）" if details else ""))
    return args["content"] + ("\n\n## 待辦\n" + "\n".join(lines) if lines else "")


def notion_tools(access_token: Callable[[], str], meetings_page: NotionLocation | None, *,
                 todos_as_checkboxes: bool, grounding: Grounding | None = None) -> list[AgentTool]:
    """讀取類：搜尋、讀頁面。寫入類只有在使用者指定了會議紀錄位置時才提供，而且一律建在那個頁面底下——模型不能自己挑地方
    寫（見 docs/adr/0009）。todos_as_checkboxes：待辦放在 Notion（打勾清單）還是 Google Tasks（這裡只列清單）。"""

    def mcp(name: str, arguments: dict[str, Any]) -> str:
        try:
            return call_tool(access_token(), name, arguments)
        except NotionError as exc:
            raise ToolFailed(str(exc)) from exc

    tools = [
        AgentTool("notion_search", "（Notion，讀取）搜尋使用者的 Notion。", _object({"query": {"type": "string"}}, ["query"]),
                  ToolKind.READ, "正在搜尋 Notion…",
                  lambda args: mcp("notion-search", {"query": text_argument(args, "query")})),
        AgentTool("notion_fetch", "（Notion，讀取）讀一個頁面。",
                  _object({"id": {"type": "string", "description": "網址或 ID"}}, ["id"]),
                  ToolKind.READ, "正在讀取 Notion…", lambda args: mcp("notion-fetch", {"id": text_argument(args, "id")})),
    ]
    if meetings_page is not None:
        def page_proposal(args: dict[str, Any]) -> dict[str, Any]:
            return {"title": text_argument(args, "title"), "content": text_argument(args, "content"),
                    "todos": _meeting_todos(args, grounding)}

        def create_page(args: dict[str, Any]) -> str:
            content = meeting_page_content(args, checkboxes=todos_as_checkboxes)
            return url_of(mcp("notion-create-pages", {
                "parent": {"type": "page_id", "page_id": meetings_page.id},
                "pages": [{"properties": {"title": args["title"]}, "content": content}]}))

        tools.append(AgentTool(
            "notion_create_meeting_page",
            f"（Notion，寫入）在使用者指定的頁面「{meetings_page.title}」底下，替這場會議建立一頁會議紀錄：content 是會議紀錄"
            "（重點、決議、下一步，Markdown），todos 是這場會議的待辦（每條的負責人填講者目前的名字、期限是 YYYY-MM-DD、"
            "會議沒講期限就不要填 due、timestamp 是" + _TIMESTAMP_RULE + "），會一起寫在這一頁。一場會議只提一頁。"
            "只會記成提案，等使用者確認。",
            _object({"title": {"type": "string"}, "content": {"type": "string", "description": "會議紀錄，Markdown"},
                     "todos": {"type": "array", "items": _object({
                         "title": {"type": "string"}, "assignee": {"type": "string"},
                         "due": {"type": "string", "description": "YYYY-MM-DD"},
                         "timestamp": {"type": "string", "description": _TIMESTAMP_RULE}}, ["title"])}},
                    ["title", "content"]),
            ToolKind.WRITE, "正在整理行動提案…", page_proposal, service="notion", proposal_kind="notion_page",
            execute=create_page))
    return tools


def result_text(result: Any) -> str:
    return result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)


