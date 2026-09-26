import json
import logging
from dataclasses import dataclass

from app.models import QuestionKind
from app.services.chapter_generator import TimedLine, format_timed_lines, parse_json_reply
from app.services.llm_client import ChatModel, UsageSink, chat

logger = logging.getLogger(__name__)

TRUE_FALSE_OPTIONS = ["是", "否"]
_MULTIPLE_CHOICE_OPTION_COUNT = 4
_MAX_TOKENS = 8192

_PROMPT_TEMPLATE = (
    "你是一個出題助手。以下是一段錄音的逐字稿，每行開頭是該片段的開始時間（秒），多人對話時標了講者名稱。\n"
    "請依整段內容出 {count} 題繁體中文測驗，選擇題與是非題混合，題目要能從逐字稿找到答案；"
    "多人對話時可以考「誰說了什麼」。\n"
    "只回傳 JSON 陣列，不要 Markdown code fence、不要其他文字，恰好 {count} 個元素，每個元素是下列其中一種：\n"
    '選擇題 {{"type": "multiple_choice", "question": string, "options": [4 個 string], '
    '"answer": 正確選項的位置（0 到 3）, "explanation": string, "timestamps": [number]}}\n'
    '是非題 {{"type": "true_false", "question": string, "answer": true 或 false, "explanation": string, '
    '"timestamps": [number]}}\n'
    "timestamps 是答案依據的片段開始時間，照抄逐字稿行首的數字。\n\n{transcript}"
)


class QuizFormatError(Exception):
    """模型回傳的測驗格式不對；重試同樣的輸入不會比較好，算永久性失敗。"""


@dataclass(frozen=True)
class GeneratedQuestion:
    kind: QuestionKind
    prompt: str
    options: list[str]
    correct_option: int
    explanation: str
    source_timestamps: list[float]


def generate_quiz(
    lines: list[TimedLine], question_count: int, *, model: ChatModel, meter: UsageSink | None
) -> list[GeneratedQuestion]:
    """依逐字稿（每行一個片段）出一份 question_count 題的測驗。格式不對 raise QuizFormatError；時間戳只留
    對得到某個片段開始時間的（依模型看到的、取到小數一位的時間比對，存片段真正的開始時間）。"""
    logger.info("calling %s (%s) for a %d-question quiz", model.provider, model.model, question_count)
    prompt = _PROMPT_TEMPLATE.format(count=question_count, transcript=format_timed_lines(lines))
    result = chat(model, [{"role": "user", "content": prompt}], max_tokens=_MAX_TOKENS, meter=meter)
    try:
        items = parse_json_reply(result.text or "")
    except json.JSONDecodeError as exc:
        raise QuizFormatError("不是 JSON") from exc
    if not isinstance(items, list) or len(items) != question_count:
        raise QuizFormatError(f"應該要有 {question_count} 題")
    segment_starts: dict[str, float] = {}
    for line in lines:
        segment_starts.setdefault(_as_shown(line.start_time), line.start_time)  # two within 0.1 s: the first
    return [_question(item, position, segment_starts) for position, item in enumerate(items, start=1)]


def _question(item: object, position: int, segment_starts: dict[str, float]) -> GeneratedQuestion:
    if not isinstance(item, dict):
        raise QuizFormatError(f"第 {position} 題不是物件")
    prompt, explanation, answer = _text(item.get("question")), _text(item.get("explanation")), item.get("answer")
    if prompt is None or explanation is None:
        raise QuizFormatError(f"第 {position} 題缺少題目或解說")
    match item.get("type"):
        case QuestionKind.MULTIPLE_CHOICE:
            raw_options = item.get("options")
            options = [_text(option) for option in raw_options] if isinstance(raw_options, list) else []
            if len(options) != _MULTIPLE_CHOICE_OPTION_COUNT or None in options:
                raise QuizFormatError(f"第 {position} 題的選項不是 {_MULTIPLE_CHOICE_OPTION_COUNT} 個")
            # bool is an int in Python; true/false isn't an option's position.
            if isinstance(answer, bool) or not isinstance(answer, int) or not 0 <= answer < len(options):
                raise QuizFormatError(f"第 {position} 題的正確答案不在選項裡")
            kind, correct_option = QuestionKind.MULTIPLE_CHOICE, answer
        case QuestionKind.TRUE_FALSE:
            if not isinstance(answer, bool):
                raise QuizFormatError(f"第 {position} 題的正確答案不是 true 或 false")
            kind, options, correct_option = QuestionKind.TRUE_FALSE, TRUE_FALSE_OPTIONS, 0 if answer else 1
        case other:
            raise QuizFormatError(f"第 {position} 題的題型「{other}」不支援")
    return GeneratedQuestion(
        kind=kind, prompt=prompt, options=[option for option in options if option is not None],
        correct_option=correct_option, explanation=explanation,
        source_timestamps=_known_timestamps(item.get("timestamps"), segment_starts))


def _as_shown(seconds: float) -> str:
    # The time as the model saw it at the start of each line (see format_timed_lines).
    return f"{seconds:.1f}"


def _text(value: object) -> str | None:
    """去掉前後空白的文字；不是文字或是空的就是 None。"""
    return value.strip() or None if isinstance(value, str) else None


def _known_timestamps(value: object, segment_starts: dict[str, float]) -> list[float]:
    """對得到某個片段開始時間的時間戳（片段真正的開始時間），其餘丟掉；格式不對就當沒有。"""
    if not isinstance(value, list):
        return []
    known = []
    for timestamp in value:
        if isinstance(timestamp, (int, float)) and not isinstance(timestamp, bool):
            start = segment_starts.get(_as_shown(float(timestamp)))
            if start is not None and start not in known:
                known.append(start)
    return known
