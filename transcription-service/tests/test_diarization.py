"""講者分離在另一個 process 跑（docs/adr/0003）：子 process 出錯或被砍掉時 raise DiarizationFailed，不會卡住。"""

from pathlib import Path

import pytest

from app.services import diarization


def test_a_failure_inside_the_diarization_process_comes_back_as_diarization_failed(monkeypatch, tmp_path):
    monkeypatch.setattr(diarization, "_threshold", lambda: 0.6)

    with pytest.raises(diarization.DiarizationFailed):
        diarization.diarize(tmp_path / "not-there.mp3")
