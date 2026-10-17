def time_key(start, end) -> tuple[float, float]:
    """片段的起訖時間當作對應用的鍵：embedding 跟逐字稿片段兩邊都是 NUMERIC(10,2)，以這個精度比較。"""
    return round(float(start), 2), round(float(end), 2)


def clock(seconds: float) -> str:
    """給人（與模型）看的時間：12:34，一小時以上是 1:02:03。"""
    hours, rest = divmod(int(seconds), 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes:02d}:{secs:02d}"
