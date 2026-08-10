package com.transuai.gateway.web.dto;

import java.util.List;

public record JobListResponseDto(List<JobDto> jobs, int totalCount, int page, int pageSize) {
}
