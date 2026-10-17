package com.transuai.gateway.web.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;

// model 可以省略（用預設模型）；給了就只用在這一次提問，只看 provider 與 model。
// webSearch：這一題也查網路（見 ai-service CONTEXT.md「網路搜尋」）；可以省略（不查）——所以是 Boolean，不是 boolean：
// Jackson 3 預設不接受缺少的基本型別欄位，舊的前端不帶這個欄位也要能問。
public record QuestionRequestDto(@Size(max = 2000) String question, @Valid ModelChoiceDto model, Boolean webSearch) {

    public boolean searchesTheWeb() {
        return Boolean.TRUE.equals(webSearch);
    }
}
