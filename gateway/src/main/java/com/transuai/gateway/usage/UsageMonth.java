package com.transuai.gateway.usage;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.YearMonth;
import java.time.ZoneId;

import com.google.protobuf.Timestamp;
import com.transuai.gateway.grpc.GrpcTimestamps;

/** 用量的「某個月」依台灣時間切：使用者看到的月份跟他的月曆一致。 */
public record UsageMonth(YearMonth month) {

    private static final ZoneId ZONE = ZoneId.of("Asia/Taipei");

    public static UsageMonth current() {
        return new UsageMonth(YearMonth.now(Clock.system(ZONE)));
    }

    public Timestamp start() {
        return GrpcTimestamps.fromInstant(startOf(month));
    }

    public Timestamp end() {
        return GrpcTimestamps.fromInstant(startOf(month.plusMonths(1)));
    }

    /** 到下個月 1 日還有幾秒（用量上限在那時恢復）。 */
    public static long secondsUntilNextMonth() {
        return Math.max(1, Duration.between(Instant.now(), startOf(current().month().plusMonths(1))).toSeconds());
    }

    @Override
    public String toString() {
        return month.toString();
    }

    private static Instant startOf(YearMonth month) {
        return month.atDay(1).atStartOfDay(ZONE).toInstant();
    }
}
