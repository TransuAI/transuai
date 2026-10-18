# auth-service

音訊/影片逐字稿 + AI 分析平台的 Auth Service。負責使用者註冊/登入、簽發與換發 JWT，是純內部服務（透過 API Gateway 對外），服務間溝通走 **gRPC**，不提供業務用 REST API（跟 [`upload-service`](../upload-service) 一致）。

## 技術棧

| 項目 | 選擇 |
|---|---|
| 框架 | Spring Boot 4.1（Java 26） |
| API | gRPC（`org.springframework.boot:spring-boot-starter-grpc-server`），開發階段開放 [reflection](https://grpc.io/docs/guides/reflection/) |
| 資料庫 | PostgreSQL（`auth_db`），Hibernate `ddl-auto=update` 自動建表（MVP 階段，尚未導入 Flyway） |
| 密碼雜湊 | `spring-security-crypto` 的 `DelegatingPasswordEncoder`：新的雜湊用 PBKDF2-HMAC-SHA256（310,000 次，帶 `{pbkdf2}` 前綴）；之前沒有前綴的是 bcrypt，照樣認得，登入成功時換成 PBKDF2（bcrypt 只看前 72 個位元組，長密碼會被截斷或拒絕）。沒有拉整個 Spring Security starter，這個服務不需要 filter chain / session |
| JWT | [`jjwt`](https://github.com/jwtio/jjwt) 簽發，HS256 對稱簽章 |
| 身分傳遞 | 這個服務**簽發** access token；Gateway 驗證前端傳來的 access token（用同一把 `app.jwt.secret` 本地驗章，不會每個請求都回頭呼叫這裡），驗證通過後透過 gRPC metadata `x-user-id` 轉發給下游服務——跟 upload-service 的模式完全一致，見下方「身分模型」 |

## 身分模型

```
前端登入 → Gateway 呼叫 AuthService.Login → 簽發 access token（15 分鐘）+ refresh token（7 天）
前端後續請求帶 Authorization: Bearer <access_token> → Gateway 用 app.jwt.secret 本地驗章/驗效期
  → 驗證通過，解出 user_id → 呼叫下游服務（Upload/Transcription/AI/Auth）時帶 x-user-id metadata
  → 下游服務都不重新驗證 JWT，只信任 Gateway 轉發的 x-user-id（跟 upload-service 相同模式）
access token 過期 → 前端呼叫 POST /auth/refresh（帶 refresh_token）→ Gateway 直接轉發給 AuthService.Refresh
  → AuthService 驗證 refresh token（自己簽的，自己驗；還要在 refresh_tokens 查得到、沒有作廢），舊的作廢、換發新的一組 access/refresh token
登出 → POST /auth/logout（帶 refresh_token）→ AuthService.Logout 作廢那一串；登出所有裝置 → POST /auth/logout-all → AuthService.LogoutAllDevices
刪除帳號 → POST /auth/account/delete（再輸入密碼）→ AuthService.DeleteAccount：刪掉使用者、發 account.deleted

改密碼 → POST /auth/password（目前的密碼＋新密碼）→ AuthService.ChangePassword：作廢這位使用者所有的 refresh token、存新的雜湊、為這次簽一組新的 token、寄通知信

註冊 → 有設定寄信時寄確認信（`{FRONTEND_URL}/verify-email#token=…`，24 小時、一次性）→ 使用者按「確認」→ POST /auth/verify-email → AuthService.VerifyEmail
忘記密碼 → POST /auth/password-reset { email } → AuthService.RequestPasswordReset：有這個帳號**而且 email 確認過**才寄重設連結（`{FRONTEND_URL}/reset-password#token=…`），不然也一樣回成功
  → 使用者點連結 → POST /auth/password-reset/confirm { token, newPassword } → AuthService.ResetPassword：用掉 token、作廢所有登入、存新的雜湊、寄通知信
收不到信 → POST /auth/password-reset/recovery-code { email, code, newPassword } → AuthService.ResetPasswordWithRecoveryCode：用掉那組復原碼、作廢所有登入、存新的雜湊、寄通知信
```

### 確認 email 與復原碼

忘記密碼不只靠 email（ASVS 2.5.6）：

- **確認 email**（`security/EmailVerifications`，`email_verification_tokens`，`users.email_verified_at`）：有設定寄信時，註冊後寄確認信（token 跟重設連結
  一樣：256 bits、只存雜湊、一次性，`EMAIL_VERIFICATION_TTL` 24 小時；重寄時舊的作廢）。**重設密碼的信只寄給確認過的 email**——沒確認的地址可能根本
  不是這個人的。確認頁要使用者按一下才確認（信箱的連結掃描程式打開頁面不會代為確認）。沒有設定寄信的部署不寄、也不要求確認。這個功能上線前註冊的
  帳號都是「還沒確認」，要到設定頁重寄確認信。
- **復原碼**（`security/RecoveryCodes`，`recovery_codes`）：要目前的密碼才能產生（錯了 `PERMISSION_DENIED`），一次 10 組、每組 20 個字（從 32 個不容易
  看錯的字母數字挑，100 bits，格式 `XXXXX-XXXXX-XXXXX-XXXXX`），只存正規化後（大寫、去掉空白與 -）的 SHA-256；產生新的時舊的全部作廢；只有產生的
  那一次回傳明文；一組只能用一次。用 email＋一組復原碼可以直接設新密碼（email 或復原碼不對是同一個錯誤），之後作廢所有登入。產生與使用都寄通知信。
  `GetMe` 與登入的回應帶 `email_verified`、`recovery_codes_left`。

### 管理員

`users.role`（`admin`／`member`，`User.is_admin`）。安裝包（`infra/deploy/install.sh`）產生 `INITIAL_ADMIN_EMAIL`、`INITIAL_ADMIN_PASSWORD`：
啟動時（gRPC 開始接受請求之前，`service/InitialAdmin`）還沒有任何帳號就用它建立管理員，標記 `must_change_password`——登入後 access token 帶
`pwc` claim，gateway 只放行看自己、改密碼、登出所有裝置，直到改了密碼（或用忘記密碼／復原碼重設）。已經有帳號時不做任何事；兩個值只設一個、
或密碼不合規則（12 字元以上、不是常見密碼）時不啟動。沒設定時（開發環境）**還沒有任何帳號時註冊的那一個是管理員**（用 advisory lock 鎖住判斷，
同時註冊的兩個人只有一個是），之後的都是一般使用者。已經有使用者的部署用 `infra/scripts/make-admin.sh <email>` 指定。管理員能改系統設定（寄信在這裡；模型、語音辨識在各自的
服務，見 `.scratch/system-settings/spec.md`）。`GetSystemStatus`（不需要 `x-user-id`）告訴登入前的頁面：還沒有任何帳號（`setup_required`，註冊頁寫「建立
管理員帳號」）、有沒有設定寄信（`mail_enabled`，沒有的話前端不顯示忘記密碼的 email 方式與 email 確認）。

### 寄信（忘記密碼、帳號異動通知）

`mail/AccountMail` 用 SMTP 寄純文字信（ASVS 2.2.3、2.5.5）：重設密碼的連結、密碼改了／重設了的通知（含時間，「如果不是你本人做的，請馬上用忘記密碼重設」）。
SMTP 由部署的單位提供：管理員在系統設定頁存的（`mail_settings` 那一列，密碼用 `KEY_ENCRYPTION_KEY` AES-256-GCM 加密，`security/SecretBox`；存了馬上生效，
有「寄測試信」），沒存過就用環境變數（`SMTP_*`、`MAIL_FROM`，見「環境變數」）——由 `mail/MailConfig` 決定每次用哪一組。都沒有的時候，忘記密碼回 `UNAVAILABLE`（「這個系統沒有設定寄信…」，
跟 email 無關，不透露有沒有這個帳號），通知只記 log 不寄。信在背景的一條 thread 寄，呼叫端不等 SMTP：寄不出去只記 log，忘記密碼的回應時間也
不會因為「有這個帳號、要寄信」而變長。

重設 token（`security/PasswordResets`，`password_reset_tokens`）：256 bits 隨機、只存 SHA-256、一次性、`PASSWORD_RESET_TTL`（30 分鐘）內有效；申請新的、
或重設成功時，同一位使用者其他還沒用的都作廢；刪除帳號時一起刪。token 放在連結的 `#` 後面，瀏覽器不會把它送到伺服器、也不會出現在存取紀錄或
Referer 裡。新密碼先照規則檢查，不合就不用掉連結。

每個簽出去的 refresh token 在 `refresh_tokens` 有一列（只存 SHA-256 雜湊；JWT 的 `jti` 對到這一列）。同一次登入一路換發出來的屬於
同一串（family）。換發時舊的作廢（輪替）、同一串簽新的；已經換發過的又被用一次，表示有兩個人拿著同一個 token——視為被盜，整串作廢
（正主下次換發也會失敗、要重新登入）。例外：剛換發的 10 秒內（`JWT_REFRESH_REUSE_GRACE_SECONDS`）再用一次不算，前端多個分頁共用同一個
refresh token，幾乎同時換發時第二個拿的是剛被換掉的舊 token。一串最多維持 30 天（`JWT_SESSION_MAX_DAYS`，`family_expires_at`）：一路換發出來的 token
也不會超過那一刻，之後要重新輸入密碼（ASVS 3.3.2）。登出作廢那一串；登出所有裝置作廢這位使用者的全部。access token 帶 `sid`
（＝那一串的 id，換發也一樣），`Logout` 回傳作廢的那一串，gateway 用它讓已簽出的 access token 也馬上不能用（見 gateway README「登出之後的 access token」）。這個機制上線之前簽的 refresh token 沒有 `jti`，換發會失敗，要重新登入一次。

`AuthService` 這個 gRPC service 比較特別：`Register` / `Login` / `Refresh` / `Logout` 四支不需要 `x-user-id`（呼叫當下使用者還沒有 token，或 access token 已經過期；`Logout` 靠 refresh token 本身），`GetMe`、`LogoutAllDevices` 與 `DeleteAccount` 需要——所以 `UserIdServerInterceptor` 這裡是**依 method** 而不是整個 service 豁免，跟 upload-service 用整個 service 豁免 `InternalJobService` 不一樣，理由寫在 [`UserIdServerInterceptor`](src/main/java/com/transuai/auth_service/grpc/auth/UserIdServerInterceptor.java) 的註解。

**`app.jwt.secret` 必須跟 gateway 的 `app.jwt.secret` 完全一致**——這是這兩個服務之間唯一的隱性耦合，本機開發共用同一組預設值即可，正式環境要覆蓋成夠長的隨機值時，兩邊要同時改。

## 前置需求

需要先啟動基礎設施（只需要 Postgres）：

```bash
cd ../infra
cp .env.example .env   # 第一次使用才需要
docker compose up -d
```

詳見 [`infra/README.md`](../infra/README.md)。

## 啟動服務

```bash
./gradlew bootRun
```

會綁一個 port：

- **`9091`**：gRPC，唯一的 API 入口（沒有 `spring-boot-starter-webmvc`，這個服務完全不開 HTTP port）

## 測試 gRPC API

跟 upload-service 一樣沒有 Swagger/OpenAPI，靠 [server reflection](https://grpc.io/docs/guides/reflection/)：

```bash
# 列出所有 service
grpcurl -plaintext localhost:9091 list

# 註冊（不需要任何 metadata）
grpcurl -plaintext \
  -d '{"email":"alice@example.com","password":"correct horse battery","displayName":"Alice"}' \
  localhost:9091 transuai.auth.v1.AuthService/Register

# 登入
grpcurl -plaintext \
  -d '{"email":"alice@example.com","password":"correct horse battery"}' \
  localhost:9091 transuai.auth.v1.AuthService/Login

# 查詢目前使用者（模擬 Gateway 驗證完 JWT 後轉發 x-user-id；user_id 從上面 Register/Login 回應的 user.id 拿）
grpcurl -plaintext -H "x-user-id: <user_id>" \
  -d '{}' \
  localhost:9091 transuai.auth.v1.AuthService/GetMe

# 換發新 token（refresh_token 從 Register/Login 回應拿）
grpcurl -plaintext \
  -d '{"refreshToken":"<refresh_token>"}' \
  localhost:9091 transuai.auth.v1.AuthService/Refresh
```

Proto 定義（等同於這個服務的 API 規格書）在 [`../infra/proto/auth.proto`](../infra/proto/auth.proto)。

### API 一覽

`AuthService`（`transuai.auth.v1`）：

| RPC | 說明 |
|---|---|
| `Register` | 建立帳號（還沒有任何帳號時，這個是管理員），email 已存在回 `ALREADY_EXISTS`；密碼 12 到 128 個字元（以字元算，任何字元都可以，不限制種類），而且不能太常見（`security/CommonPasswords`），不合回 `INVALID_ARGUMENT`（「密碼至少要 12 個字元」「這個密碼太常見，很容易被猜到，請換一個」）；成功直接簽發 token，不用再呼叫一次 `Login` |
| `Login` | email/password 其中一項錯誤都回 `UNAUTHENTICATED`（不細分，避免帳號列舉）；帳號不存在時也比對一次雜湊，回應時間跟密碼錯一樣長，不能用時間猜帳號。猜密碼的次數由 gateway 限流 |
| `Refresh` | 用 refresh token 換發新的 access/refresh token 組合，舊的作廢（輪替）；token 無效、過期、型別不對（例如誤傳 access token）、查不到、已經作廢都回 `UNAUTHENTICATED`；已經換發過的又被用一次（超過 10 秒寬限）視為被盜，整串作廢 |
| `Logout` | 作廢這個 refresh token 所在的那一串並回傳它（`session_id`，＝access token 的 `sid`）；token 無效或已經作廢也回成功（`session_id` 空的） |
| `LogoutAllDevices` | 依 `x-user-id` 作廢這位使用者所有的 refresh token，回傳 access token 可能還沒過期的那幾串（`ended_session_ids`） |
| `GetMe` | 依 `x-user-id` 查目前使用者資訊，找不到（例如帳號已被刪除）回 `NOT_FOUND` |
| `DeleteAccount` | 刪除帳號（`x-user-id`）：再確認一次密碼，錯了回 `PERMISSION_DENIED`（不是 `UNAUTHENTICATED`——前端會以為 token 過期去換發）；通過就在同一個交易裡刪掉使用者、他所有的 refresh token，並把 `account.deleted { userId }` 寫進 outbox（見下方「刪除帳號」）。找不到使用者回 `NOT_FOUND`。猜密碼的次數由 gateway 限流 |
| `VerifyEmail` | 確認 email（不需要 `x-user-id`）：確認信裡的 token；無效、過期、用過了回 `FAILED_PRECONDITION` |
| `ResendEmailVerification` | 重寄確認信（`x-user-id`）：已經確認就什麼都不做；沒有設定寄信 `UNAVAILABLE` |
| `GenerateRecoveryCodes` | 產生復原碼（`x-user-id`）：目前的密碼錯了 `PERMISSION_DENIED`；舊的作廢，回傳新的 10 組，寄通知信 |
| `ResetPasswordWithRecoveryCode` | 用 email＋一組復原碼設新密碼（不需要 `x-user-id`）：不對（不分是 email 還是復原碼）或用過了 `FAILED_PRECONDITION`；新密碼不合規則 `INVALID_ARGUMENT`（不用掉復原碼）；成功就作廢所有登入、寄通知信，回傳同 `ResetPassword` |
| `RequestPasswordReset` | 忘記密碼（不需要 `x-user-id`）：email 有註冊、而且確認過就寄重設連結，不然也回成功；沒有設定寄信時 `UNAVAILABLE`（見「寄信」） |
| `ResetPassword` | 用重設連結的 token 設新密碼（不需要 `x-user-id`）：token 無效、過期、用過了回 `FAILED_PRECONDITION`；新密碼照註冊的規則（`INVALID_ARGUMENT`，不合時 token 不用掉）；成功就作廢所有登入、寄通知信，回傳 `user_id` 與作廢的那幾串（`ended_session_ids`） |
| `GetSystemStatus` | 不需要 `x-user-id`：`setup_required`（還沒有任何帳號）、`mail_enabled`（有沒有設定寄信） |
| `GetMailSettings`／`UpdateMailSettings` | 系統設定的寄信（`x-user-id`，不是管理員 `PERMISSION_DENIED`）：目前用的設定（存的或環境變數），密碼只回有沒有設定；存了馬上生效，密碼空的是不改、`clear_password` 清掉、`use_environment` 回到環境變數；存密碼卻沒有 `KEY_ENCRYPTION_KEY` 是 `FAILED_PRECONDITION` |
| `SendTestMail` | 用目前的設定寄一封測試信（管理員）：`to` 空的就寄給自己，等它寄完，寄不出去回 `sent=false` 與原因 |
| `ChangePassword` | 改密碼（`x-user-id`）：目前的密碼錯回 `PERMISSION_DENIED`（理由同 `DeleteAccount`），新密碼照註冊的規則、而且不能跟目前的一樣（`INVALID_ARGUMENT`）；清掉「要先改密碼」。通過就先作廢這位使用者所有的 refresh token（改密碼常是懷疑被盜用；中途失敗頂多被登出），再存新的雜湊，回一組新的 token 與作廢的那幾串（`ended_session_ids`：最近一個 access token 效期內簽過 token 的，gateway 讓那些 access token 也馬上不能用） |

## 刪除帳號

`DeleteAccount` 不自己去清別的服務：`account.deleted` 經 outbox（`outbox_events`，跟刪除同一個交易）由 `event/OutboxPublisher` 每秒送到 RabbitMQ 的
fanout exchange `account.deleted`，等 broker 確認收到才刪掉那一筆（送失敗下一輪重送，至少送一次）。upload-service 刪掉他所有的 Job（每個再發
`job.deleted`）、ai-service 撤銷並刪掉已連結的帳號與個人設定、兩個服務把用量去識別化（見 `docs/adr/0005-deletion-events-fan-out-through-an-outbox.md`、
`.scratch/account-deletion/spec.md`）。帳號一刪，同一個 email 馬上可以重新註冊（全新的帳號）。所以這個服務現在也連 RabbitMQ（只發送）。

## 環境變數

| 變數 | 預設值 | 說明 |
|---|---|---|
| `APP_ENV` | `development` | `production` 時檢查密鑰並關掉開發用的東西，見「正式環境」 |
| `DB_HOST` / `DB_PORT` | `localhost` / `5432` | Postgres |
| `DB_USER` / `DB_PASSWORD` | `admin` / `0000` | Postgres 帳密 |
| `JWT_SECRET` | `dev-only-shared-secret-change-me-before-any-real-deployment` | HS256 簽章密鑰，**必須跟 gateway 的 `JWT_SECRET` 一致**；正式環境務必覆蓋 |
| `JWT_ACCESS_TOKEN_TTL_MINUTES` | `15` | access token 效期 |
| `JWT_REFRESH_TOKEN_TTL_DAYS` | `7` | refresh token 效期 |
| `JWT_REFRESH_REUSE_GRACE_SECONDS` | `10` | 已經換發過的 refresh token 在這幾秒內再用一次不算被盜（多個分頁同時換發） |
| `JWT_SESSION_MAX_DAYS` | `30` | 一次登入最多維持幾天（一路換發也不超過），之後要重新登入 |
| `SMTP_HOST` / `SMTP_PORT` | 空 / `587` | 寄信的 SMTP 主機（系統設定頁存過就用存的）；都沒有的時候忘記密碼不能用、通知不寄 |
| `SMTP_USERNAME` / `SMTP_PASSWORD` | 空 | SMTP 帳密（`SMTP_AUTH=true` 時用） |
| `SMTP_AUTH` / `SMTP_STARTTLS` | `true` / `true` | 要不要登入 SMTP、要不要（而且一定要）STARTTLS；本機的測試用 SMTP 才設 `false` |
| `MAIL_FROM` | 空 | 寄件人；空的時候同樣不寄 |
| `INITIAL_ADMIN_EMAIL`、`INITIAL_ADMIN_PASSWORD` | 空 | 安裝時建立的管理員（見「管理員」）：還沒有任何帳號時用它建立、第一次登入要改密碼；空的時候第一個註冊的帳號是管理員 |
| `KEY_ENCRYPTION_KEY` | 空 | 系統設定頁存的 SMTP 密碼用這把加密（base64 的 32 bytes，跟 ai-service、transcription-service 同一把）；空的時候不能在設定頁存密碼 |
| `FRONTEND_URL` | `http://localhost:5173` | 信裡連結指向的前端（跟 gateway 同一個值） |
| `PASSWORD_RESET_TTL` | `30m` | 重設連結多久內有效 |
| `EMAIL_VERIFICATION_TTL` | `24h` | 確認 email 的連結多久內有效 |
| `RABBITMQ_HOST` / `RABBITMQ_PORT` | `localhost` / `5672` | RabbitMQ（刪除帳號時發 `account.deleted`） |
| `RABBITMQ_USER` / `RABBITMQ_PASSWORD` | `admin` / `0000` | RabbitMQ 帳密 |

## 專案結構

```
src/main/java/com/transuai/auth_service/
  domain/           User entity、RefreshToken、PasswordResetToken、EmailVerificationToken、RecoveryCode、OutboxEventEntity（outbox）
  repository/        Spring Data JPA repository
  security/           JwtProperties（@ConfigurationProperties）、JwtService（簽 access/refresh、驗證 refresh）、RefreshTokens（refresh token 的記錄、輪替、作廢）、PasswordResets（忘記密碼的重設 token）、EmailVerifications（確認 email 的 token）、RecoveryCodes（復原碼）、OneTimeTokens（信裡的一次性 token 與雜湊）、AuthLinks（信裡的連結）、CommonPasswords（太常見的密碼：SecLists 10k-most-common，打包在 `resources/common-passwords.txt`，MIT 授權見同目錄的 `.LICENSE`；不連外。也擋清單裡的密碼前後加數字或符號、同一段重複）
  config/             SecurityConfig（PasswordEncoder bean：PBKDF2，認得舊的 bcrypt）、RabbitConfig（account.deleted fanout exchange）
  service/            AccountDeletion（刪使用者、refresh token、重設與確認的 token、復原碼，account.deleted 寫進 outbox）
  mail/               AccountMail（重設連結與帳號異動通知的信，SMTP，背景寄）
  event/              OutboxPublisher（把 outbox 送到 RabbitMQ，publisher confirm）
  grpc/               AuthGrpcService（rpc 實作）、UserMapper（domain ↔ proto）
  grpc/auth/          UserIdServerInterceptor（依 method 豁免，見上方「身分模型」）、GrpcAuthContext
  grpc/advice/        GrpcExceptionAdvice —— 注意這裡特別 handle 了 StatusRuntimeException/StatusException
                       原樣放行，因為 JwtService 是直接 throw Status.xxx().asRuntimeException()
                       （不像其他 rpc 都用 responseObserver.onError()），不放行的話會被最下面的
                       Exception catch-all 吃掉、錯誤地降級成 INTERNAL（開發時實測踩到這個坑）
```

## 正式環境（`APP_ENV=production`）

`APP_ENV` 預設是 `development`；設成 `production`（Java 服務用 `spring.profiles.active=${APP_ENV:development}`，就是 `production` profile）時：

- 啟動前檢查密鑰（`config/ProductionSecretsCheck`）：`JWT_SECRET`（至少 32 字元）、`DB_PASSWORD`、`RABBITMQ_PASSWORD` 沒設、還是開發用的預設值（`0000`、`admin`、`dev-only-…` 這類，跟 `infra/k8s/02-secret.yaml` 一致）、
  或少於 12 字元，就不啟動，錯誤訊息列出是哪幾個環境變數。
- gRPC reflection 關掉（`application-production.properties`）。

開發環境都不檢查、照舊開著。見 `.scratch/pre-launch-hardening/issues/07`。

## 依賴套件弱點掃描

掃 build 出來的 Spring Boot jar（裡面就是正式執行時的所有依賴），用 [Grype](https://github.com/anchore/grype)（Docker 跑，不用安裝）對照 GitHub
Advisory 等弱點資料庫：

```bash
./gradlew bootJar -x test
docker run --rm -v grype-db:/root/.cache/grype -v "$PWD/build/libs/auth_service-0.0.1-SNAPSHOT.jar:/scan/app.jar:ro" anchore/grype:latest file:/scan/app.jar
```

沒用 OWASP Dependency-Check：它要先下載 NVD 全部資料（沒有 NVD API key 時很慢），而且靠 CPE 比對、誤報多；Grype 直接認 jar 裡的套件座標。
上線前、以及之後每個月或升級依賴時跑一次。高風險、嚴重的要升級，或在這裡寫清楚為什麼不影響。

Spring Boot 管理的版本跟不上弱點修正時，在 `build.gradle` 用 `ext['…version']` 覆蓋（目前覆蓋 Jackson、Tomcat、RabbitMQ amqp-client，
見 `build.gradle` 的註解）；升級 Spring Boot 之後它管理的版本追上了，就拿掉對應的覆蓋。

最近一次結果：2026-10-03：Spring Boot 4.1.0 → 4.1.1 加上覆蓋之後沒有已知弱點（原本有 Netty、Jackson、PostgreSQL JDBC、log4j-api 的高風險／嚴重弱點，都是 Spring Boot 管理的傳遞依賴）。

## 已知限制 / 待辦

- Schema 目前靠 Hibernate `ddl-auto=update` 自動建表，團隊變大或要上正式環境前應改用 Flyway 做版本化 migration
- 過期、作廢的 `refresh_tokens` 不會自動清掉（每次登入、換發多一列），量大了要加定期清理
- 沒有 MFA／TOTP（復原方式是 email 連結與復原碼）；改不了 email；常見密碼只比對打包的 10,000 個（客戶內部部署可能不能連外，不查 Have I Been Pwned）
- 測試：`./gradlew test`。refresh token 的輪替、被盜偵測、登出、30 天上限，密碼規則、改密碼、忘記密碼與通知信（`RefreshTokenTest`、`RefreshTokenGraceTest`、`PasswordPolicyTest`、`ChangePasswordTest`、`PasswordResetTest`（SMTP 用 mock）、`PasswordResetWithoutMailTest`、`EmailVerificationAndRecoveryCodesTest`：Spring Boot test、in-process gRPC、Postgres 用 Testcontainers 起臨時容器，要有 Docker）；`Login` 的單元測試（`AuthGrpcServiceLoginTest`）；正式環境的密鑰檢查。其餘靠手動 smoke test（grpcurl / 一次性 Python 腳本）
