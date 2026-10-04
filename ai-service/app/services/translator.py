"""翻譯逐字稿的片段（見 CONTEXT.md「譯文」、.scratch/transcript-translation）：一批一批送，每個片段翻成一句、保留它的時間與講者（譯文
跟原文片段一一對應）。模型看到的是短的行號（不是片段 id，省 token），要回同樣數量、同樣行號的 JSON；對不上整批算失敗，由呼叫端重試。
前面幾句只當上下文、不翻。講者名稱不送（是使用者取的名字，不翻）。中文目標一律繁體。"""

import json

from app.services.chapter_generator import parse_json_reply
from app.services.llm_client import ChatModel, UsageSink, chat
from app.services.traditional_chinese import to_traditional

# 目標語言：代碼 → 給模型看的名字。
LANGUAGES: dict[str, str] = {
    "zh-TW": "繁體中文（台灣用語）",
    "en": "English",
    "ja": "日本語",
    "ko": "한국어",
}

_MAX_TOKENS = 8192

_PROMPT_TEMPLATE = (
    "請把下面這些語音辨識的句子翻譯成{language}。每個 JSON 物件是一句（n 是行號），逐句翻譯：\n"
    "- 每一句都要翻、只翻那一句，不要合併、拆開或補充內容；人名、產品名照原文。\n"
    "- 語音辨識可能有錯字，照最可能的意思翻；本來就是{language}的句子照抄。\n"
    "- 翻得自然通順，像這個語言的人說的話。\n"
    '只回傳 JSON 陣列，每句一個 {{"n": 行號, "text": "譯文"}}，數量與行號跟輸入一樣。不要其他文字。\n'
    "{context}"
    "要翻譯的句子：\n{lines}"
)


class TranslationFormatError(Exception):
    """模型回的不是這一批的譯文（不是 JSON、數量或行號對不上、有空的）。"""


def translate_batch(segments: list[tuple[str, str]], language: str, *, context: list[str], model: ChatModel,
                    meter: UsageSink | None) -> dict[str, str]:
    """翻譯一批片段（片段 id, 原文），回傳 片段 id → 譯文。context 是前面幾句的原文（不翻，只幫模型理解）。"""
    lines = "\n".join(json.dumps({"n": n, "text": text}, ensure_ascii=False) for n, (_, text) in enumerate(segments, start=1))
    context_block = ("前面的句子（只是上下文，不用翻譯）：\n" + "\n".join(context) + "\n\n") if context else ""
    prompt = _PROMPT_TEMPLATE.format(language=LANGUAGES[language], context=context_block, lines=lines)
    reply = chat(model, [{"role": "user", "content": prompt}], max_tokens=_MAX_TOKENS, meter=meter)
    try:
        data = parse_json_reply(reply.text)
    except ValueError as exc:
        raise TranslationFormatError("not JSON") from exc
    if not isinstance(data, list):
        raise TranslationFormatError("not a JSON array")
    by_number: dict[int, str] = {}
    for item in data:
        if not isinstance(item, dict) or not isinstance(item.get("n"), int) or not isinstance(item.get("text"), str):
            raise TranslationFormatError("an item isn't {n, text}")
        by_number[item["n"]] = item["text"].strip()
    if set(by_number) != set(range(1, len(segments) + 1)) or not all(by_number.values()):
        raise TranslationFormatError("the lines don't match the batch")
    convert = to_traditional if language == "zh-TW" else (lambda text: text)
    return {segment_id: convert(by_number[n]) for n, (segment_id, _) in enumerate(segments, start=1)}
