package com.transuai.auth_service.security;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

import org.springframework.stereotype.Component;

/**
 * 太常見、一猜就中的密碼（ASVS 2.1.7）。清單是 SecLists 的 10k-most-common（MIT，見 {@code common-passwords.LICENSE}），打包在服務裡：
 * 客戶內部部署可能不能連外，不呼叫 Have I Been Pwned。
 * <p>
 * 清單裡的密碼幾乎都短於 12 字元，只比對整個密碼擋不到什麼，所以也擋：清單裡的密碼（至少 4 個字）前後只加了數字或符號
 * （{@code iloveyou2024!}）、同一段重複（{@code abcabcabcabc}、{@code 123123123123}）。都不分大小寫。
 */
@Component
public class CommonPasswords {

    private static final int MIN_BASE_LENGTH = 4;
    private static final Pattern PADDING = Pattern.compile("^[\\p{N}\\p{P}\\p{S}\\s]+|[\\p{N}\\p{P}\\p{S}\\s]+$");
    private static final Pattern REPEATED = Pattern.compile("^(.{1,6}?)\\1+$", Pattern.DOTALL);

    private final Set<String> passwords;

    public CommonPasswords() {
        this.passwords = load("common-passwords.txt");
    }

    public boolean isTooCommon(String password) {
        String lower = password.toLowerCase(Locale.ROOT);
        if (passwords.contains(lower) || REPEATED.matcher(lower).matches()) {
            return true;
        }
        String base = PADDING.matcher(lower).replaceAll("");
        return base.length() >= MIN_BASE_LENGTH && passwords.contains(base);
    }

    private static Set<String> load(String resource) {
        Set<String> loaded = new HashSet<>();
        try (InputStream in = CommonPasswords.class.getClassLoader().getResourceAsStream(resource)) {
            if (in == null) {
                throw new IllegalStateException(resource + " is missing from the classpath");
            }
            BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
            for (String line = reader.readLine(); line != null; line = reader.readLine()) {
                if (!line.isBlank()) {
                    loaded.add(line.strip().toLowerCase(Locale.ROOT));
                }
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return Set.copyOf(loaded);
    }
}
