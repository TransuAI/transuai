package com.transuai.upload_service.domain;

import java.util.Set;

// Job 的類型（見 CONTEXT.md「類型」）：AI 依內容判斷，使用者可以改。值原樣存在 jobs.category、原樣傳給前端。
public final class JobCategory {

    public static final Set<String> ALL = Set.of("meeting", "lecture", "interview", "podcast", "video", "other");

    private JobCategory() {
    }

    public static boolean isKnown(String category) {
        return ALL.contains(category);
    }
}
