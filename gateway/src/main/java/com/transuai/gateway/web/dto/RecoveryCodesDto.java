package com.transuai.gateway.web.dto;

import java.util.List;

// 新產生的復原碼：只有這一次回傳，之後只看得到還剩幾組（UserDto.recoveryCodesLeft）。
public record RecoveryCodesDto(List<String> codes) {
}
