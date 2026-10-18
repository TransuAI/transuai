"""聽哪個介面是設定（HTTP_HOST）：預設只聽本機，container image 設成 0.0.0.0（見 Dockerfile）。"""

from app import main
from app.core.config import Settings


def test_by_default_it_listens_on_this_machine_only():
    assert Settings().http_host == "127.0.0.1"


def test_it_listens_where_http_host_says(monkeypatch):
    calls = []
    monkeypatch.setattr(main.uvicorn, "run", lambda app, **options: calls.append(options))
    monkeypatch.setattr(main.settings, "http_host", "0.0.0.0")

    main.serve()

    assert calls[0]["host"] == "0.0.0.0"
    assert calls[0]["port"] == main.settings.http_port
