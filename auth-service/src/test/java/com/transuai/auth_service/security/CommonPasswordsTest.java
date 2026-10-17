package com.transuai.auth_service.security;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** 太常見的密碼（.scratch/pre-launch-hardening/issues/15，ASVS 2.1.7）：清單裡的、清單裡的加上數字或符號、同一段重複；不分大小寫。 */
class CommonPasswordsTest {

    private final CommonPasswords common = new CommonPasswords();

    @Test
    void aPasswordOnTheListIsTooCommonWhateverItsCase() {
        assertThat(common.isTooCommon("password")).isTrue();
        assertThat(common.isTooCommon("QWERTYUIOP")).isTrue();
    }

    @Test
    void aListedPasswordWithOnlyDigitsOrSymbolsAroundItIsTooCommon() {
        assertThat(common.isTooCommon("iloveyou2024!")).isTrue();
        assertThat(common.isTooCommon("Password1234")).isTrue();
        assertThat(common.isTooCommon("!!sunshine99")).isTrue();
    }

    @Test
    void theSameShortPieceOverAndOverIsTooCommon() {
        assertThat(common.isTooCommon("aaaaaaaaaaaa")).isTrue();
        assertThat(common.isTooCommon("abcabcabcabc")).isTrue();
        assertThat(common.isTooCommon("123123123123")).isTrue();
    }

    @Test
    void ordinaryLongPasswordsAreFine() {
        assertThat(common.isTooCommon("correct horse battery staple")).isFalse();
        assertThat(common.isTooCommon("我家的貓叫做麻糬")).isFalse();
        assertThat(common.isTooCommon("a-good-password")).isFalse();
        // A listed word too short to count, with digits around it, isn't enough to reject the whole thing.
        assertThat(common.isTooCommon("abc12345678!")).isFalse();
    }
}
