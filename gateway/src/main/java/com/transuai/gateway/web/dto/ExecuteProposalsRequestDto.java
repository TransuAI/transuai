package com.transuai.gateway.web.dto;

import java.util.List;

import com.fasterxml.jackson.databind.JsonNode;

// 使用者勾選的提案與確認（可能改過）的最終參數；沒列出的提案不執行。
public record ExecuteProposalsRequestDto(List<Item> proposals) {

    public record Item(String proposalId, JsonNode arguments) {
    }
}
