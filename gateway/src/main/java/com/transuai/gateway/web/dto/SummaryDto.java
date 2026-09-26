package com.transuai.gateway.web.dto;

// sourceRevision：這份摘要（跟章節）依據的逐字稿 revision；小於逐字稿目前的 revision 就是過時。
public record SummaryDto(String jobId, String summaryText, int sourceRevision) {
}
