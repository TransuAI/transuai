package com.transuai.gateway.web.dto;

import java.util.List;

// openrouterCustom：有 OpenRouter 金鑰時是 true，可以自己輸入 OpenRouter 模型 ID。
// webSearch：問答可以查網路（部署有設定搜尋服務）；false 時前端不顯示「查網路」。
public record AvailableModelsDto(List<ModelChoiceDto> models, boolean openrouterCustom, boolean webSearch) {
}
