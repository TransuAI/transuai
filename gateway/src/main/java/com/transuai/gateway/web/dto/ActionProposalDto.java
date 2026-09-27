package com.transuai.gateway.web.dto;

import com.fasterxml.jackson.databind.JsonNode;

// 行動提案：service 例如 "google_calendar"；tool 是確認後要呼叫的工具，例如 "calendar_create_event"；kind 決定前端用
// 哪種表單，例如 "calendar_event"（arguments：summary、start、end、description）。
public record ActionProposalDto(String id, String service, String tool, String kind, JsonNode arguments) {
}
