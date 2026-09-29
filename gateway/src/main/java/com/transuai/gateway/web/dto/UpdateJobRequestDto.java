package com.transuai.gateway.web.dto;

/** 使用者改標題／類型：沒帶（null）的欄位不動；標題空字串＝清空（顯示檔名）。 */
public record UpdateJobRequestDto(String title, String category) {
}
