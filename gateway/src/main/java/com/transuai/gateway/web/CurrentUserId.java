package com.transuai.gateway.web;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/** 標在 controller method 的 UUID 參數上，取得 {@link com.transuai.gateway.security.JwtAuthenticationFilter} 解出的目前使用者 id。 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.PARAMETER)
public @interface CurrentUserId {
}
