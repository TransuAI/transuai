# 憑證（HTTPS）

TransuAI 一定要用 HTTPS：登入用的 refresh token cookie 是 `__Host-` 開頭、`Secure`，瀏覽器只在 HTTPS 上收。

## 預設：自簽憑證

`install.sh` 用 `openssl` 產生一張自簽憑證（`tls/tls.crt`、`tls/tls.key`，825 天），主機名或 IP 是安裝時填的網址。瀏覽器會警告
「不是私人連線」——內部測試可以先接受，正式使用請換成單位自己的憑證，或把這張憑證加到使用者電腦的信任清單（AD 群組原則等）。

## 換成單位自己的憑證

1. 準備 PEM 格式的檔案：
   - `tls.crt`：伺服器憑證，後面接中繼憑證（完整的憑證鏈）。
   - `tls.key`：私鑰（不要有密碼）。
   憑證的 SAN 要包含 `.env` 的 `TRANSUAI_URL` 裡的主機名。
2. 放進 `tls/`（覆蓋原本的），`chmod 644 tls/tls.crt tls/tls.key`：edge 的 nginx 不是用 root 跑，要讀得到私鑰。這台主機的登入權限只給
   管理它的人。
3. `docker compose restart edge`。

用 Let's Encrypt 等公開憑證時（主機有公開網域），用 certbot 在主機上申請，續期後把檔案複製到 `tls/` 再 restart edge。

## 換網址或 port

改 `.env` 的 `TRANSUAI_URL`、`FRONTEND_URL`、`OAUTH_CALLBACK_BASE_URL`、`STORAGE_PUBLIC_ENDPOINT`（四個要一致）與
`TRANSUAI_HTTPS_PORT`，換一張符合新主機名的憑證，再 `docker compose up -d`。

## 前面已經有反向代理或負載平衡器

讓它把 HTTPS 轉給這台的 `TRANSUAI_HTTPS_PORT`（edge 仍然用 TLS，憑證可以是內部的），並且原樣保留 `Host` 標頭——物件儲存的
presigned URL 簽章包含 Host，改了上傳與播放會失敗。edge 只把直接連進來的位址當成使用者的來源位址。

TLS 設定是 Mozilla 的 "intermediate"（TLS 1.2、1.3），在 [edge/default.conf.template](../edge/default.conf.template)。
