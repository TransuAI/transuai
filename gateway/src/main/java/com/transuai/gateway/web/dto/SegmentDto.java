package com.transuai.gateway.web.dto;

public record SegmentDto(double startTime, double endTime, String speakerLabel, String text) {
}
