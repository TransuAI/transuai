# 前端的部署包（客戶內部部署用，見 nginx/default.conf.template 與 infra/docs/deployment-checklist.md）：
# build 出靜態檔，由 nginx（不用 root 跑）提供，同一個網站轉 /api 到 gateway、/ws 到 notification-service。
#   docker build -t transuai/frontend:dev frontend
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY nginx/page-headers.conf /etc/nginx/snippets/page-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
# 預設值：k8s 的 Service 名稱；部署時用環境變數改（STORAGE_ORIGIN 是瀏覽器連物件儲存用的網址，進 CSP）。
ENV GATEWAY_URL=http://gateway:8080 \
    NOTIFICATION_URL=http://notification-service:8085 \
    STORAGE_ORIGIN=http://localhost:19000 \
    TRUSTED_PROXY_CIDR=127.0.0.1/32
EXPOSE 8080
