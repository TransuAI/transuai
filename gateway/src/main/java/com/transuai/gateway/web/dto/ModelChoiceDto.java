package com.transuai.gateway.web.dto;

import jakarta.validation.constraints.Size;

// 一個可以選的模型；provider 是 "platform"（平台模型）或廠商名稱。supportsTools：能不能呼叫工具（會後處理需要）。
public record ModelChoiceDto(@Size(max = 50) String provider, @Size(max = 200) String model, boolean supportsTools) {
}
