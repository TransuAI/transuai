package com.transuai.auth_service.security;

import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.transuai.auth_service.domain.RecoveryCode;
import com.transuai.auth_service.repository.RecoveryCodeRepository;

/**
 * 復原碼（ASVS 2.5.6 的離線復原方式）：一次 10 組，每組 20 個字（4 段、每段 5 個，從 32 個不容易看錯的字母與數字裡挑，100 bits），
 * 只存正規化後的 SHA-256；產生新的時舊的全部作廢；一組只能用一次。輸入時不分大小寫，空白與 - 可有可無。
 */
@Service
public class RecoveryCodes {

    public static final int COUNT = 10;
    private static final String ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final SecureRandom RANDOM = new SecureRandom();

    private final RecoveryCodeRepository repository;

    public RecoveryCodes(RecoveryCodeRepository repository) {
        this.repository = repository;
    }

    /** 新的一組復原碼（只有這一次拿得到明文），之前的全部作廢。 */
    @Transactional
    public List<String> generate(UUID userId) {
        repository.deleteByUserId(userId);
        List<String> codes = new ArrayList<>();
        for (int i = 0; i < COUNT; i++) {
            String code = newCode();
            codes.add(code);
            repository.save(RecoveryCode.builder().id(UUID.randomUUID()).userId(userId).codeHash(hash(code)).build());
        }
        return codes;
    }

    /** 用掉一組：這位使用者有這組、還沒用過就是 true。 */
    @Transactional
    public boolean useUp(UUID userId, String code) {
        return repository.findUnusedForUpdate(userId, hash(code))
                .map(found -> {
                    found.setUsedAt(OffsetDateTime.now(ZoneOffset.UTC));
                    return true;
                })
                .orElse(false);
    }

    public int left(UUID userId) {
        return (int) repository.countUnused(userId);
    }

    private static String newCode() {
        StringBuilder code = new StringBuilder();
        for (int i = 0; i < 20; i++) {
            if (i > 0 && i % 5 == 0) {
                code.append('-');
            }
            code.append(ALPHABET.charAt(RANDOM.nextInt(ALPHABET.length())));
        }
        return code.toString();
    }

    private static String hash(String code) {
        return OneTimeTokens.sha256(code.toUpperCase(Locale.ROOT).replaceAll("[\\s-]", ""));
    }
}
