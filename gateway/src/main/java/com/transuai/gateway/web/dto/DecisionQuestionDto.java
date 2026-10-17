package com.transuai.gateway.web.dto;

import java.util.List;

import jakarta.validation.constraints.Size;

// 問決策（決策頁的問答框）：question 必填；category、jobIds 跟決策頁的篩選一樣，只問那些 Job 的決策。
public record DecisionQuestionDto(@Size(max = 2000) String question, @Size(max = 50) String category,
        @Size(max = 200) List<@Size(max = 64) String> jobIds) {
}
