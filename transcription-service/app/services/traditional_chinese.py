from dataclasses import replace
from functools import lru_cache

import opencc

from app.services.transcriber import TranscriptResult

# 刻意用 s2tw（逐字轉成台灣標準字形），不用 s2twp：s2twp 會額外做詞彙替換（例如「软件」→「軟體」、
# 「局部」→「區域性」），等於改寫說話者實際的用詞，逐字稿應該忠實呈現原話，只換字形不換詞。
_CONFIG = "s2tw"

# 只轉換中文：日文漢字的新字體（例如「国」）也會被 s2tw 轉成繁體字形，不能一律套用。Whisper 的
# verbose_json 回傳的是語言全名（實測 Groq 回 "Chinese"），這裡也容許大小寫差異跟常見的語言代碼。
_CHINESE_LANGUAGES = {"chinese", "mandarin", "cantonese", "zh", "cmn", "yue"}


def _is_chinese(language: str) -> bool:
    normalized = language.strip().lower()
    return normalized in _CHINESE_LANGUAGES or normalized.startswith("zh-")


@lru_cache(maxsize=1)
def _converter() -> opencc.OpenCC:
    return opencc.OpenCC(_CONFIG)


def to_traditional_if_chinese(result: TranscriptResult) -> TranscriptResult:
    """中文的轉錄結果：把全文與每個片段文字轉成繁體（台灣標準字形）；其他語言原樣回傳。"""
    if not _is_chinese(result.language):
        return result
    convert = _converter().convert
    return replace(
        result,
        full_text=convert(result.full_text),
        segments=[replace(seg, text=convert(seg.text)) for seg in result.segments],
    )
