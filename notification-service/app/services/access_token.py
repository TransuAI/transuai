import uuid

import jwt


class InvalidAccessToken(Exception):
    """access token 不能用：簽章不對、過期、不是 access token、或 subject 不是使用者 id。不細分原因。"""


# auth-service 用 jjwt 的 signWith(key) 簽：演算法依密鑰長度決定（HS256／HS384／HS512），三種都要收。
_ALGORITHMS = ["HS256", "HS384", "HS512"]


def user_id_from(access_token: str, secret: str) -> str:
    """驗證 access token（auth-service 簽發，跟 gateway 的 JwtService 一樣本地驗章、驗效期、驗 type），回傳使用者 id。"""
    try:
        claims = jwt.decode(access_token, secret, algorithms=_ALGORITHMS, options={"require": ["exp", "sub"]})
    except jwt.PyJWTError as error:
        raise InvalidAccessToken("invalid or expired access token") from error
    if claims.get("type") != "access":
        raise InvalidAccessToken("not an access token")
    try:
        return str(uuid.UUID(claims["sub"]))
    except (ValueError, TypeError) as error:
        raise InvalidAccessToken("invalid access token subject") from error
