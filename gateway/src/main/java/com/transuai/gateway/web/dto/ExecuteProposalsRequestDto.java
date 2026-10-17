package com.transuai.gateway.web.dto;

import java.util.List;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import tools.jackson.databind.JsonNode;

// 使用者勾選的提案與確認（可能改過）的最終參數；沒列出的提案不執行。
public record ExecuteProposalsRequestDto(@Size(max = 50) List<@Valid Item> proposals) {

    public record Item(@Size(max = 64) String proposalId, JsonNode arguments) {
    }
}
