package com.transuai.gateway.web.dto;

public record SaveProviderKeyRequestDto(String key) {

    // record 預設的 toString 會印出金鑰；任何地方把請求寫進 log 時都不能帶出來。
    @Override
    public String toString() {
        return "SaveProviderKeyRequestDto[key=***]";
    }
}
