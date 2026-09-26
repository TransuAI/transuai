from app.services.hf_client import stream_without_thinking


def test_a_short_answer_is_not_lost():
    # Shorter than "<think>": the whole answer used to stay in the buffer when the stream ended.
    assert "".join(stream_without_thinking(["沒有", "。"])) == "沒有。"


def test_a_leading_think_block_is_dropped():
    assert "".join(stream_without_thinking(["<think>", "想一想", "</think>", "答案是", "四十二"])) == "答案是四十二"


def test_once_it_is_clear_there_is_no_think_block_deltas_pass_straight_through():
    assert list(stream_without_thinking(["今天的", "重點是", "預算", "。"])) == ["今天的重點是預算", "。"]


def test_an_unfinished_think_block_yields_nothing():
    assert "".join(stream_without_thinking(["<think>", "還在想"])) == ""
