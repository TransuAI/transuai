package com.transuai.gateway.web.dto;

import java.util.List;

// openrouterCustom：有 OpenRouter 金鑰時是 true，可以自己輸入 OpenRouter 模型 ID。
public record AvailableModelsDto(List<ModelChoiceDto> models, boolean openrouterCustom) {
}
