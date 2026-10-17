package com.transuai.gateway.web.dto;

import transuai.ai.v1.Ai.WebSource;

// 問答查網路時，回答依據的一個網頁（網路來源）。
public record WebSourceDto(String title, String url) {

    public static WebSourceDto from(WebSource source) {
        return new WebSourceDto(source.getTitle(), source.getUrl());
    }
}
