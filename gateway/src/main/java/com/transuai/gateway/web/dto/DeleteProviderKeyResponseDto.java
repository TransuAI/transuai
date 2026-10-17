package com.transuai.gateway.web.dto;

// deleted 是 false 代表本來就沒有這把金鑰；defaultModelReset 是 true 代表預設模型正在用它，已改回平台模型。
public record DeleteProviderKeyResponseDto(boolean deleted, boolean defaultModelReset) {
}
