def time_key(start, end) -> tuple[float, float]:
    """片段的起訖時間當作對應用的鍵：embedding 跟逐字稿片段兩邊都是 NUMERIC(10,2)，以這個精度比較。"""
    return round(float(start), 2), round(float(end), 2)
