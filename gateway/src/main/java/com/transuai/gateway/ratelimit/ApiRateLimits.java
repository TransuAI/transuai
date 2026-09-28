package com.transuai.gateway.ratelimit;

import java.util.Map;
import java.util.UUID;
import java.util.function.Function;

import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.HandlerMapping;

import com.transuai.gateway.security.JwtAuthenticationFilter;

import jakarta.servlet.DispatcherType;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;

/**
 * 每個 API 都限流：登入的使用者每人一個總上限（{@code perUser}），沒登入的請求每個 IP 一個（{@code perAddress}）；會觸發轉錄或
 * 呼叫 AI 的功能另外有更嚴的每人上限（下面的表）。在 JWT 驗證之後、controller 之前（HandlerInterceptor，看得到對到哪個路由）；
 * 登入與註冊另外還有 {@link AuthRateLimits}。
 */
@Component
@RequiredArgsConstructor
public class ApiRateLimits implements HandlerInterceptor {

    /** 花錢的功能：「方法 路由」→ 它自己的上限。 */
    private static final Map<String, CostlyFeature> COSTLY = Map.of(
            "POST /uploads/complete", new CostlyFeature("upload", RateLimitProperties::upload),
            "POST /qa/{jobId}", new CostlyFeature("question", RateLimitProperties::question),
            "POST /jobs/{jobId}/quizzes", new CostlyFeature("quiz", RateLimitProperties::quiz),
            "POST /summary/{jobId}/regenerate", new CostlyFeature("regenerate", RateLimitProperties::regenerate),
            "POST /jobs/{jobId}/post-meeting", new CostlyFeature("post-meeting", RateLimitProperties::postMeeting),
            "PUT /me/provider-keys/{provider}", new CostlyFeature("provider-key", RateLimitProperties::providerKey));

    private final RateLimiter limiter;
    private final RateLimitProperties properties;

    private record CostlyFeature(String name, Function<RateLimitProperties, RateLimitProperties.Rule> rule) {
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        // 只算真正的請求：串流結束時的 async 重新分派、錯誤頁的分派不再算一次。
        if (request.getDispatcherType() != DispatcherType.REQUEST || !(handler instanceof HandlerMethod)) {
            return true;
        }
        if (!(request.getAttribute(JwtAuthenticationFilter.USER_ID_ATTRIBUTE) instanceof UUID user)) {
            require(limiter.hit("all:ip:" + request.getRemoteAddr(), properties.perAddress()));
            return true;
        }
        require(limiter.hit("all:user:" + user, properties.perUser()));
        CostlyFeature costly = COSTLY.get(request.getMethod() + " "
                + request.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE));
        if (costly != null) {
            require(limiter.hit(costly.name() + ":user:" + user, costly.rule().apply(properties)));
        }
        return true;
    }

    private static void require(RateLimiter.Decision decision) {
        if (!decision.allowed()) {
            throw RateLimitedException.tooFrequent(decision.retryAfterSeconds());
        }
    }
}
