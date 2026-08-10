# auth-service

音訊/影片逐字稿 + AI 分析平台的 Auth Service。負責使用者註冊/登入、簽發與換發 JWT，是純內部服務（透過 API Gateway 對外），服務間溝通走 **gRPC**，不提供業務用 REST API（跟 [`upload-service`](../upload-service) 一致）。

## 技術棧

| 項目 | 選擇 |
|---|---|
| 框架 | Spring Boot 4.1（Java 26） |
| API | gRPC（`org.springframework.boot:spring-boot-starter-grpc-server`），開發階段開放 [reflection](https://grpc.io/docs/guides/reflection/) |
| 資料庫 | PostgreSQL（`auth_db`），Hibernate `ddl-auto=update` 自動建表（MVP 階段，尚未導入 Flyway） |
| 密碼雜湊 | `spring-security-crypto` 的 `BCryptPasswordEncoder`（沒有拉整個 Spring Security starter，這個服務不需要 filter chain / session） |
| JWT | [`jjwt`](https://github.com/jwtio/jjwt) 簽發，HS256 對稱簽章 |
| 身分傳遞 | 這個服務**簽發** access token；Gateway 驗證前端傳來的 access token（用同一把 `app.jwt.secret` 本地驗章，不會每個請求都回頭呼叫這裡），驗證通過後透過 gRPC metadata `x-user-id` 轉發給下游服務——跟 upload-service 的模式完全一致，見下方「身分模型」 |

## 身分模型

```
前端登入 → Gateway 呼叫 AuthService.Login → 簽發 access token（15 分鐘）+ refresh token（7 天）
前端後續請求帶 Authorization: Bearer <access_token> → Gateway 用 app.jwt.secret 本地驗章/驗效期
  → 驗證通過，解出 user_id → 呼叫下游服務（Upload/Transcription/AI/Auth）時帶 x-user-id metadata
  → 下游服務都不重新驗證 JWT，只信任 Gateway 轉發的 x-user-id（跟 upload-service 相同模式）
access token 過期 → 前端呼叫 POST /auth/refresh（帶 refresh_token）→ Gateway 直接轉發給 AuthService.Refresh
  → AuthService 驗證 refresh token（自己簽的，自己驗），換發新的一組 access/refresh token
```

`AuthService` 這個 gRPC service 比較特別：`Register` / `Login` / `Refresh` 三支不需要 `x-user-id`（呼叫當下使用者還沒有 token），只有 `GetMe` 需要——所以 `UserIdServerInterceptor` 這裡是**依 method** 而不是整個 service 豁免，跟 upload-service 用整個 service 豁免 `InternalJobService` 不一樣，理由寫在 [`UserIdServerInterceptor`](src/main/java/com/transuai/auth_service/grpc/auth/UserIdServerInterceptor.java) 的註解。

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
  -d '{"email":"alice@example.com","password":"hunter22","displayName":"Alice"}' \
  localhost:9091 transuai.auth.v1.AuthService/Register

# 登入
grpcurl -plaintext \
  -d '{"email":"alice@example.com","password":"hunter22"}' \
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
| `Register` | 建立帳號，email 已存在回 `ALREADY_EXISTS`；成功直接簽發 token，不用再呼叫一次 `Login` |
| `Login` | email/password 其中一項錯誤都回 `UNAUTHENTICATED`（不細分，避免帳號列舉） |
| `Refresh` | 用 refresh token 換發新的 access/refresh token 組合；token 無效、過期、或型別不對（例如誤傳 access token）都回 `UNAUTHENTICATED` |
| `GetMe` | 依 `x-user-id` 查目前使用者資訊，找不到（例如帳號已被刪除）回 `NOT_FOUND` |

## 環境變數

| 變數 | 預設值 | 說明 |
|---|---|---|
| `DB_HOST` / `DB_PORT` | `localhost` / `5432` | Postgres |
| `DB_USER` / `DB_PASSWORD` | `admin` / `0000` | Postgres 帳密 |
| `JWT_SECRET` | `dev-only-shared-secret-change-me-before-any-real-deployment` | HS256 簽章密鑰，**必須跟 gateway 的 `JWT_SECRET` 一致**；正式環境務必覆蓋 |
| `JWT_ACCESS_TOKEN_TTL_MINUTES` | `15` | access token 效期 |
| `JWT_REFRESH_TOKEN_TTL_DAYS` | `7` | refresh token 效期 |

## 專案結構

```
src/main/java/com/transuai/auth_service/
  domain/           User entity
  repository/        Spring Data JPA repository
  security/           JwtProperties（@ConfigurationProperties）、JwtService（簽發 access/refresh、驗證 refresh）
  config/             SecurityConfig（BCryptPasswordEncoder bean）
  grpc/               AuthGrpcService（4 支 rpc 實作）、UserMapper（domain ↔ proto）
  grpc/auth/          UserIdServerInterceptor（依 method 豁免，見上方「身分模型」）、GrpcAuthContext
  grpc/advice/        GrpcExceptionAdvice —— 注意這裡特別 handle 了 StatusRuntimeException/StatusException
                       原樣放行，因為 JwtService 是直接 throw Status.xxx().asRuntimeException()
                       （不像其他 rpc 都用 responseObserver.onError()），不放行的話會被最下面的
                       Exception catch-all 吃掉、錯誤地降級成 INTERNAL（開發時實測踩到這個坑）
```

## 已知限制 / 待辦

- Schema 目前靠 Hibernate `ddl-auto=update` 自動建表，團隊變大或要上正式環境前應改用 Flyway 做版本化 migration
- Refresh token 是純 stateless JWT，沒有存 DB，無法個別撤銷（例如使用者登出或換裝置時沒辦法讓舊 refresh token 失效）——對應 [`architecture-design.md`](../architecture-design.md) §7 簡化建議「先做簡單 JWT，不做完整 OAuth2 flow」，要做撤銷需要另開 `refresh_tokens` 表追蹤
- 沒有帳號刪除、密碼重設、email 驗證等功能，架構文件 §3.1 只列了 register/login/refresh/me 四支，這裡照實作
- 沒有測試，目前只靠手動 smoke test（grpcurl / 一次性 Python 腳本）
