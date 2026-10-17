package com.transuai.gateway.web;

import java.util.UUID;

import org.springframework.core.MethodParameter;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

import com.transuai.gateway.security.JwtAuthenticationFilter;

import jakarta.servlet.http.HttpServletRequest;

@Component
public class CurrentUserIdArgumentResolver implements HandlerMethodArgumentResolver {

    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        return parameter.hasParameterAnnotation(CurrentUserId.class) && parameter.getParameterType() == UUID.class;
    }

    @Override
    public Object resolveArgument(MethodParameter parameter, ModelAndViewContainer mavContainer,
            NativeWebRequest webRequest, WebDataBinderFactory binderFactory) {
        HttpServletRequest request = (HttpServletRequest) webRequest.getNativeRequest();
        Object userId = request.getAttribute(JwtAuthenticationFilter.USER_ID_ATTRIBUTE);
        if (userId == null) {
            // shouldNotFilter() 白名單漏掉某條路徑、又標了 @CurrentUserId 才會發生，代表設定本身有誤，
            // 直接炸掉比默默回傳 null、讓下游用到 null user id 更安全。
            throw new IllegalStateException(
                    "current user id not resolved; is this endpoint covered by JwtAuthenticationFilter?");
        }
        return userId;
    }
}
