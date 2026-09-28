"""模型的輸出轉成繁體（台灣標準字形）。提示詞已經要求用繁體中文，但本機的小模型偶爾整段回簡體（實測 qwen3.5:9b），
這是最後一道保險。跟 transcription-service 一樣用 OpenCC 的 s2tw：只換字形、不換用詞。

只有**整段是簡體**時才轉：「干」「台」「里」這類字在繁體裡本來就對，把已經是繁體的回答再轉一次會改壞（實測「干擾」變成
「幹擾」、「台灣」變成「臺灣」）。判斷方式是數「只有簡體才有的字」和「只有繁體才有的字」哪個多。"""

from functools import lru_cache

import opencc

# 串流時先看開頭這麼多個中文字再決定轉不轉，之後照同一個決定；更短的回答在結束時決定。
_DECIDE_AFTER_CHINESE_CHARACTERS = 30


@lru_cache(maxsize=None)
def _converter(config: str) -> opencc.OpenCC:
    return opencc.OpenCC(config)


def _is_chinese_character(ch: str) -> bool:
    return "一" <= ch <= "鿿"


def _looks_simplified(text: str) -> bool:
    """只有簡體才有的字（轉繁體會變、轉簡體不變）比只有繁體才有的字多。"""
    to_traditional_chars, to_simplified_chars = _converter("s2t"), _converter("t2s")
    simplified = traditional = 0
    for ch in text:
        if not _is_chinese_character(ch):
            continue
        if to_traditional_chars.convert(ch) != ch and to_simplified_chars.convert(ch) == ch:
            simplified += 1
        elif to_simplified_chars.convert(ch) != ch:
            traditional += 1
    return simplified > traditional


def _to_taiwan_glyphs(text: str) -> str:
    return _converter("s2tw").convert(text)


def to_traditional(text: str) -> str:
    """整段是簡體就轉成繁體，否則原樣回傳。"""
    return _to_taiwan_glyphs(text) if text and _looks_simplified(text) else text


class TraditionalStream:
    """串流輸出（問答的回答）用：先暫存開頭，看夠了再決定整段轉不轉，之後的片段照同一個決定。feed() 回傳現在可以送出的文字，
    結束時呼叫 flush() 送出剩下的（很短的回答在這時才決定）。"""

    def __init__(self) -> None:
        self._pending = ""
        self._convert: bool | None = None

    def feed(self, delta: str) -> str:
        if self._convert is not None:
            return _to_taiwan_glyphs(delta) if self._convert else delta
        self._pending += delta
        if sum(1 for ch in self._pending if _is_chinese_character(ch)) < _DECIDE_AFTER_CHINESE_CHARACTERS:
            return ""
        return self._decide()

    def flush(self) -> str:
        return self._decide() if self._convert is None else ""

    def _decide(self) -> str:
        self._convert = _looks_simplified(self._pending)
        text, self._pending = self._pending, ""
        return _to_taiwan_glyphs(text) if self._convert else text
