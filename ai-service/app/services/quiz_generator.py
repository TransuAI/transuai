import json
import logging
import random
from dataclasses import dataclass

from app.models import QuestionKind
from app.services.chapter_generator import TimedLine, format_timed_lines, parse_json_reply
from app.services.llm_client import ChatModel, UsageSink, chat
from app.services.traditional_chinese import to_traditional

logger = logging.getLogger(__name__)

TRUE_FALSE_OPTIONS = ["是", "否"]
_MULTIPLE_CHOICE_OPTION_COUNT = 4
_MAX_TOKENS = 8192

_PROMPT_TEMPLATE = (
    "你要替使用者上傳的一段內容（可能是會議、YouTube 影片、課程、訪談、節目或動畫等）出 {count} 題測驗，讓看完的人檢查自己"
    "有沒有抓到重點。選擇題與是非題混合。內容在最後，每行開頭是那句話的開始時間（秒），多人對話時標了講者名稱。\n"
    "出什麼題：\n"
    "- 先看出這是什麼樣的內容，再考它的重點：知識類（課程、解說、節目）考觀念、原因與比較；會議考做了哪些決定、誰負責什麼、"
    "為什麼這樣決定；故事（動畫、劇）考情節、角色與他們的動機。\n"
    "- 題目平均分布在內容的從頭到尾：依時間把內容大致分成 {count} 段，每段出一題，照時間順序排列；每題考不同的事。\n"
    "- 不考冷僻的細節（某句話的原文、只出現一次的數字）；「誰說的」只在那個人的立場或分工是重點時才考。\n"
    "- 內容是語音辨識的結果，可能有錯字：看起來不通順的詞不要拿來出題，題目裡寫校正後的字。\n"
    "- 選擇題只有一個選項是對的，其他選項照內容來看明確是錯的，但要像真的：跟正確答案同類、長度相近；不要用「以上皆是」"
    "「以上皆非」「沒有人提到」。\n"
    "- 是非題大約一半的答案是 false：把內容裡的一個關鍵事實改錯（人、數字、原因、結果），不要只加「不」字；題目用肯定句，"
    "不要用「沒有」「並未」出題（「並未提到…」答「否」很難懂）。\n"
    "怎麼寫：\n"
    "- 用台灣慣用、自然的繁體中文，題目簡短清楚；內容是外語時用中文出題，必要時在括號裡留原文的關鍵詞。\n"
    "- 直接問內容本身：題目、選項、解說都不要提到「逐字稿」「片段」「錄音」「第幾秒」或時間；題目不要加「內容中提到」"
    "「根據內容」「影片中表示」這類開頭，直接問那件事。\n"
    "- 解說一兩句，跟答案一致：說明為什麼是這個答案（是非題說清楚哪裡對、哪裡錯），提到誰說的就用他的講者名稱；"
    "外語內容用中文轉述，不要引用整句原文。\n"
    "只回傳 JSON 陣列，不要 Markdown code fence、不要其他文字，恰好 {count} 個元素，每個元素是下列其中一種：\n"
    '選擇題 {{"type": "multiple_choice", "question": string, "options": [4 個 string], '
    '"answer": 正確選項的位置（0 到 3）, "explanation": string, "timestamps": [number]}}\n'
    '是非題 {{"type": "true_false", "question": string, "answer": true 或 false, "explanation": string, '
    '"timestamps": [number]}}\n'
    "timestamps 是答案依據的那幾句話的開始時間，照抄行首的數字。\n\n{transcript}"
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
        items = parse_json_reply(to_traditional(result.text or ""))
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
            # 本機模型的正確答案多半放在第一、二個（實測），自己洗牌讓位置分散。
            order = random.sample(range(len(options)), len(options))
            options, correct_option = [options[i] for i in order], order.index(answer)
            kind = QuestionKind.MULTIPLE_CHOICE
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
