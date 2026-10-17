package com.transuai.gateway.web.dto;

import jakarta.validation.constraints.Size;

/** 使用者改標題／類型：沒帶（null）的欄位不動；標題空字串＝清空（顯示檔名）。 */
public record UpdateJobRequestDto(@Size(max = 100) String title, @Size(max = 50) String category) {
}
