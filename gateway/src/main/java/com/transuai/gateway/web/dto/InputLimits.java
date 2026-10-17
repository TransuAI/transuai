package com.transuai.gateway.web.dto;

/** 請求裡共用的上限（ASVS 5.1.4）。各欄位的長度上限直接寫在 DTO 上，數字跟下游服務自己的上限一樣。 */
public final class InputLimits {

    /** 錄音裡的時間點與錄音長度的上限（秒）：一天。單一錄音的實際上限（60 分鐘）由 transcription-service 用實際長度檢查。 */
    public static final int MAX_DURATION_SECONDS = 24 * 60 * 60;

    private InputLimits() {
    }
}
