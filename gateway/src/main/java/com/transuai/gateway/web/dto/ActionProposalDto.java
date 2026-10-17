package com.transuai.gateway.web.dto;

import tools.jackson.databind.JsonNode;

// 行動提案：service 例如 "google_calendar"；tool 是確認後要呼叫的工具，例如 "calendar_create_event"；kind 決定前端用
// 哪種表單，例如 "calendar_event"（arguments：summary、start、end、description）。status：PROPOSED（等確認）/ DONE
// （resultUrl 是建立好的項目）/ FAILED（failureReason 是原因，可以重試）。previouslyCreated：還沒執行，而且跟這個 Job
// 其他次會後處理已經建立過的事項相同（前端標示「上次已建立」、預設不勾選）。
public record ActionProposalDto(String id, String service, String tool, String kind, JsonNode arguments, String status,
        String resultUrl, String failureReason, boolean previouslyCreated) {
}
