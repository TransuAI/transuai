"""log 不記錄音內容（.scratch/pre-launch-hardening/issues/20，ASVS 7.1.2）：模型的回覆解析失敗時只記長度或缺了什麼。"""

import logging
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.services import claim_checker, job_details, speaker_names

SECRET = "董事會決定裁員三百人"


def reply(text):
    return SimpleNamespace(text=text, usage=None)


@pytest.mark.parametrize("text", [f"不是 JSON：{SECRET}", f'["{SECRET}"]'])
def test_a_title_answer_that_cannot_be_used_is_logged_without_its_words(caplog, text):
    with patch.object(job_details, "chat", return_value=reply(text)), caplog.at_level(logging.WARNING):
        assert job_details.suggest_details("摘要", [], model=None, meter=None) is None

    assert caplog.records
    assert SECRET not in caplog.text


def test_a_speaker_names_answer_that_is_not_json_is_logged_without_its_words(caplog):
    with (patch.object(speaker_names, "chat", return_value=reply(f"王小明是{SECRET}")),
          patch.object(speaker_names, "speaker_names", return_value={"S1": "講者 1", "S2": "講者 2"}),
          patch.object(speaker_names, "spoken_segments", return_value=[]),
          caplog.at_level(logging.WARNING)):
        assert speaker_names.suggest_speaker_names(None, model=None, meter=None) is None

    assert caplog.records
    assert SECRET not in caplog.text


def test_a_judgement_that_is_not_one_does_not_carry_the_models_words():
    with patch.object(claim_checker, "chat", return_value=reply(f'{{"verdict": "maybe", "explanation": "{SECRET}"}}')):
        with pytest.raises(claim_checker.JudgeFormatError) as error:
            claim_checker.judge_claim("主張", [], model=None, meter=None)

    assert SECRET not in str(error.value)
    assert "explanation" in str(error.value)
