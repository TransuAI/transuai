package com.transuai.gateway.web.dto;

import java.time.Instant;

// emailVerified：確認過 email 沒（忘記密碼的信只寄給確認過的）；recoveryCodesLeft：還沒用的復原碼有幾組；admin：管理員（能改系統設定）。
public record UserDto(String id, String email, String displayName, Instant createdAt, boolean emailVerified,
        int recoveryCodesLeft, boolean admin) {
}
