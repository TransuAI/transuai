package com.transuai.auth_service.grpc;

import com.transuai.auth.grpc.v1.User;

public final class UserMapper {

    private UserMapper() {
    }

    // 這裡的 domain.User 跟 proto 產生的 User 撞名，故意不 import domain 版本、每次用都寫全名，
    // 跟 upload-service 的 JobMapper 處理 domain.Job / proto Job 撞名是同一招。
    public static User toProto(com.transuai.auth_service.domain.User user, int recoveryCodesLeft) {
        return User.newBuilder()
                .setId(user.getId().toString())
                .setEmail(user.getEmail())
                .setDisplayName(user.getDisplayName() == null ? "" : user.getDisplayName())
                .setCreatedAt(GrpcTimestamps.toProto(user.getCreatedAt()))
                .setEmailVerified(user.getEmailVerifiedAt() != null)
                .setRecoveryCodesLeft(recoveryCodesLeft)
                .setIsAdmin(user.isAdmin())
                .build();
    }
}
