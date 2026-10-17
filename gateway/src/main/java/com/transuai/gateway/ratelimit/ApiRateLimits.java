package com.transuai.gateway.ratelimit;

import java.util.Objects;
import java.util.UUID;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import com.transuai.gateway.security.JwtAuthenticationFilter;

import jakarta.servlet.DispatcherType;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;

/**
 * 每個 API 都限流：登入的使用者每人一個總上限（{@code perUser}），沒登入的請求每個 IP 一個（{@code perAddress}，token 無效被
 * {@link JwtAuthenticationFilter} 擋下的也算，見 {@link #rejectedByAuthentication}）；標了 {@link CostlyFeature} 的 API 每人另外有更嚴的
 * 上限。在 JWT 驗證之後、controller 之前（HandlerInterceptor）；登入與註冊另外還有 {@link AuthRateLimits}。
 */
@Component
@RequiredArgsConstructor
public class ApiRateLimits implements HandlerInterceptor {

    private static final String ALL_BY_USER = "all:user:";
    private static final String ALL_BY_ADDRESS = "all:ip:";

    private final RateLimiter limiter;
    private final RateLimitProperties properties;

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        // 只算真正的請求：串流結束時的 async 重新分派、錯誤頁的分派不再算一次。
        if (request.getDispatcherType() != DispatcherType.REQUEST) {
            return true;
        }
        if (!(request.getAttribute(JwtAuthenticationFilter.USER_ID_ATTRIBUTE) instanceof UUID user)) {
            limiter.hit(ALL_BY_ADDRESS + request.getRemoteAddr(), properties.perAddress())
                    .orThrow(RateLimitedException::tooFrequent);
            return true;
        }
        limiter.hit(ALL_BY_USER + user, properties.perUser()).orThrow(RateLimitedException::tooFrequent);
        CostlyFeature costly = handler instanceof HandlerMethod method ? method.getMethodAnnotation(CostlyFeature.class) : null;
        if (costly != null) {
            limiter.hit(costly.value() + ":user:" + user, properties.costly().get(costly.value()))
                    .orThrow(RateLimitedException::tooFrequent);
        }
        return true;
    }

    /**
     * token 缺少或無效的請求（在 filter 就回 401，不會到 controller）：一樣算進這個 IP 的上限，超過時回 429 而不是 401，拿假
     * token 亂打的腳本也擋得到。
     */
    public void rejectedByAuthentication(HttpServletRequest request) {
        limiter.hit(ALL_BY_ADDRESS + request.getRemoteAddr(), properties.perAddress())
                .orThrow(RateLimitedException::tooFrequent);
    }

    /** 啟動時檢查：每個 {@link CostlyFeature} 都要有設定上限，漏設就不啟動（否則那個 API 會在執行時才出錯）。 */
    @Component
    @RequiredArgsConstructor
    static class CostlyFeaturesConfigured implements ApplicationRunner {

        private final RequestMappingHandlerMapping mappings;
        private final RateLimitProperties properties;

        @Override
        public void run(ApplicationArguments args) {
            mappings.getHandlerMethods().values().stream()
                    .map(method -> method.getMethodAnnotation(CostlyFeature.class))
                    .filter(Objects::nonNull)
                    .map(CostlyFeature::value)
                    .filter(name -> properties.costly() == null || !properties.costly().containsKey(name))
                    .findFirst()
                    .ifPresent(name -> {
                        throw new IllegalStateException("app.rate-limit.costly." + name + " is not configured");
                    });
        }
    }
}
