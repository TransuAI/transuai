package com.transuai.gateway.web.dto;

// 問決策（決策頁的問答框）：question 必填；category、jobId 跟決策頁的篩選一樣，只問那些 Job 的決策。
public record DecisionQuestionDto(String question, String category, String jobId) {
}
