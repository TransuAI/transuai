package com.transuai.gateway.web.dto;

// 前端用 JWT header 呼叫 API，瀏覽器轉址帶不了 header，所以回傳網址、由前端自己把使用者轉過去。
public record AuthorizeUrlDto(String authorizeUrl) {
}
