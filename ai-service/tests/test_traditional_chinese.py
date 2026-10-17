"""模型輸出的繁體保險（app/services/traditional_chinese.py）：整段是簡體才轉；已經是繁體的不能動（「干擾」「台灣」這類字在繁體裡本來
就對，一律轉會改壞成「幹擾」「臺灣」）。串流時先看開頭一小段決定，之後照同一個決定。"""

from app.services.traditional_chinese import TraditionalStream, to_traditional


def stream(*deltas: str) -> str:
    converter = TraditionalStream()
    return "".join(converter.feed(delta) for delta in deltas) + converter.flush()


def test_simplified_text_is_converted():
    assert to_traditional("这场会议确定了三项核心决策。") == "這場會議確定了三項核心決策。"


def test_traditional_text_is_left_exactly_as_it_is():
    text = "台灣的防空網整合了愛國者飛彈，透過 GPS 干擾讓巡弋飛彈失效。"

    assert to_traditional(text) == text


def test_a_simplified_stream_comes_out_traditional():
    assert stream("这场会议", "确定了三项核心决策：", "第一，改用社区贡献占总 MR 比例。") == (
        "這場會議確定了三項核心決策：第一，改用社區貢獻佔總 MR 比例。")


def test_a_traditional_stream_is_left_alone_even_with_characters_shared_with_simplified():
    deltas = ("台灣的防空網", "撐得過第一波攻擊，", "關鍵是預警與 GPS 干擾。")

    assert stream(*deltas) == "".join(deltas)


def test_a_short_answer_is_still_checked_when_the_stream_ends():
    assert stream("没有谈到。") == "沒有談到。"


def test_text_without_chinese_passes_through():
    assert stream("KPI ", "= MR ratio") == "KPI = MR ratio"
