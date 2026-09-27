package com.transuai.gateway.grpc;

public final class GrpcStrings {

    private GrpcStrings() {
    }

    // proto3 的字串沒有「沒設定」：空字串代表不知道（例如記錄模型之前的資料），API 回 null。
    public static String emptyToNull(String value) {
        return value.isEmpty() ? null : value;
    }

    // 反方向：JSON 的 null（沒給）送進 proto3 的字串欄位時是空字串。
    public static String nullToEmpty(String value) {
        return value == null ? "" : value;
    }
}
