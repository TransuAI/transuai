package com.transuai.gateway.web.dto;

// 一個可以選的模型；provider 是 "platform"（平台模型）或廠商名稱。supportsTools：能不能呼叫工具（會後處理需要）。
public record ModelChoiceDto(String provider, String model, boolean supportsTools) {
}
