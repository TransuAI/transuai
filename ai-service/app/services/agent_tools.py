"""會後處理 agent 的工具（見 CONTEXT.md「會後處理」）。每個工具是一份設定：名稱、說明、參數、讀取類還是寫入類。
讀取類真的執行、結果回給模型；寫入類不執行，只驗證參數後記成行動提案（見 docs/adr/0007）。沒列在這裡的工具 agent 看不到。"""

import json
import re
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime
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


def tasks_tools(access_token: Callable[[], str]) -> list[AgentTool]:
    def open_tasks(_args: dict[str, Any]) -> Any:
        try:
            return list_open_tasks(access_token()) or "預設清單裡沒有未完成的待辦"
        except TasksError as exc:
            raise ToolFailed(str(exc)) from exc

    def todo_proposal(args: dict[str, Any]) -> dict[str, Any]:
        proposal = {"title": text_argument(args, "title"), "due": _due_argument(args),
                    **{name: _optional_text(args, name) for name in ("notes", "assignee", "timestamp")}}
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
                  "目前的名字，timestamp 填依據的錄音時間（例如 12:34），due 是期限。只會記成提案，等使用者確認。",
                  _object({"title": {"type": "string"}, "notes": {"type": "string", "description": "補充說明"},
                           "assignee": {"type": "string"},
                           "due": {"type": "string", "description": "YYYY-MM-DD，例如 2026-11-20"},
                           "timestamp": {"type": "string", "description": "依據的錄音時間，例如 12:34"}}, ["title"]),
                  ToolKind.WRITE, "正在整理行動提案…", todo_proposal, service="google_tasks", proposal_kind="google_task",
                  execute=create),
    ]


# --- Notion（官方遠端 MCP） ---


def notion_tools(access_token: Callable[[], str], meetings_page: NotionLocation | None,
                 todo_database: NotionLocation | None) -> list[AgentTool]:
    """讀取類：搜尋、讀頁面或資料庫（含欄位結構）。寫入類只有在使用者指定了位置時才提供，而且一律寫到指定的位置——模型不能
    自己挑地方寫。"""

    def mcp(name: str, arguments: dict[str, Any]) -> str:
        try:
            return call_tool(access_token(), name, arguments)
        except NotionError as exc:
            raise ToolFailed(str(exc)) from exc

    tools = [
        AgentTool("notion_search", "（Notion，讀取）搜尋使用者的 Notion。", _object({"query": {"type": "string"}}, ["query"]),
                  ToolKind.READ, "正在搜尋 Notion…",
                  lambda args: mcp("notion-search", {"query": text_argument(args, "query")})),
        AgentTool("notion_fetch", "（Notion，讀取）讀一個頁面或資料庫；資料庫會回傳欄位結構。",
                  _object({"id": {"type": "string", "description": "網址或 ID"}}, ["id"]),
                  ToolKind.READ, "正在讀取 Notion…", lambda args: mcp("notion-fetch", {"id": text_argument(args, "id")})),
    ]
    if meetings_page is not None:
        def page_proposal(args: dict[str, Any]) -> dict[str, Any]:
            return {"title": text_argument(args, "title"), "content": text_argument(args, "content")}

        tools.append(AgentTool(
            "notion_create_meeting_page",
            f"（Notion，寫入）在使用者指定的會議紀錄頁面「{meetings_page.title}」底下建立一頁會議紀錄。只會記成提案，等使用者確認。",
            _object({"title": {"type": "string"}, "content": {"type": "string", "description": "Markdown"}},
                    ["title", "content"]),
            ToolKind.WRITE, "正在整理行動提案…", page_proposal, service="notion", proposal_kind="notion_page",
            execute=lambda args: url_of(mcp("notion-create-pages", {
                "parent": {"page_id": meetings_page.id},
                "pages": [{"properties": {"title": args["title"]}, "content": args["content"]}]}))))
    if todo_database is not None:
        def confirmed_todo(args: dict[str, Any]) -> dict[str, Any]:
            """使用者確認的值：title_property 可以沒有（加上 title_property 之前提的待辦），有的話要是其中一欄。"""
            properties = args.get("properties")
            if not isinstance(properties, dict) or not properties:
                raise ToolArgumentError("properties 要是物件：欄位名稱對到值")
            if not all(isinstance(value, (str, int, float, bool)) or value is None for value in properties.values()):
                raise ToolArgumentError("properties 的值要是文字、數字、true/false 或 null")
            title_property = args.get("title_property")
            if title_property is not None and title_property not in properties:
                raise ToolArgumentError("title_property 要是 properties 裡、資料庫的標題（title）欄位的名稱")
            content = args.get("content", "")
            if not isinstance(content, str):
                raise ToolArgumentError("content 要是文字")
            return {**({"title_property": title_property} if title_property is not None else {}),
                    "properties": properties, "content": content}

        def todo_proposal(args: dict[str, Any]) -> dict[str, Any]:
            """模型提的：一定要說哪一欄是標題，而且標題要有內容（認出同一件待辦靠它）。"""
            todo = confirmed_todo(args)
            title = todo["properties"].get(todo.get("title_property"))
            if not isinstance(title, str) or not title.strip():
                raise ToolArgumentError("title_property 要是 properties 裡、資料庫的標題（title）欄位的名稱，而且要填上待辦的標題")
            return todo

        def create_todo(args: dict[str, Any]) -> str:
            page: dict[str, Any] = {"properties": args["properties"]}
            if args["content"].strip():
                page["content"] = args["content"]
            return url_of(mcp("notion-create-pages", {"parent": {"data_source_id": todo_database.id}, "pages": [page]}))

        tools.append(AgentTool(
            "notion_create_todo",
            f"（Notion，寫入）在使用者指定的待辦資料庫「{todo_database.title}」（{todo_database.id}）新增一筆待辦。"
            "寫之前先用 notion_fetch 讀這個資料庫的欄位結構，properties 的欄位名稱要跟資料庫一樣（例如負責人、期限）；"
            "人員（person）類型的欄位填不了講者名字，負責人沒有文字欄位可填時寫進 content。依據的時間戳寫進 content。"
            "只會記成提案，等使用者確認。",
            _object({"properties": {"type": "object", "description": "欄位名稱對到值"},
                     "title_property": {"type": "string", "description": "資料庫的標題（title 類型）欄位的名稱"},
                     "content": {"type": "string", "description": "這筆待辦的內文（Markdown）：依據的時間戳、補充說明"}},
                    ["properties", "title_property"]),
            ToolKind.WRITE, "正在整理行動提案…", todo_proposal, service="notion", proposal_kind="notion_database_item",
            execute=create_todo, check_confirmed=confirmed_todo))
    return tools


def result_text(result: Any) -> str:
    return result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)


