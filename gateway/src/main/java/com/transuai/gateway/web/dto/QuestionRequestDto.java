package com.transuai.gateway.web.dto;

// model 可以省略（用預設模型）；給了就只用在這一次提問，只看 provider 與 model。
public record QuestionRequestDto(String question, ModelChoiceDto model) {
}
