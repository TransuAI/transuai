package com.transuai.gateway.web.dto;

import java.util.List;

// 一個 Job 的用量：依時間排序的每一筆，加上總計。
public record JobUsageDto(List<UsageRecordDto> records, UsageTotalsDto totals) {
}
