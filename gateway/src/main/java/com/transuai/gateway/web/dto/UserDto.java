package com.transuai.gateway.web.dto;

import java.time.Instant;

// emailVerified：確認過 email 沒（忘記密碼的信只寄給確認過的）；recoveryCodesLeft：還沒用的復原碼有幾組；admin：管理員（能改系統設定）；
// mustChangePassword：要先設定新密碼才能用別的功能（安裝時建立的管理員）。
public record UserDto(String id, String email, String displayName, Instant createdAt, boolean emailVerified,
        int recoveryCodesLeft, boolean admin, boolean mustChangePassword) {
}
