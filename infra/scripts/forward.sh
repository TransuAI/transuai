#!/bin/sh
# 前端開發要用到的 port-forward 一次全部開好：
#   gateway                -> localhost:8080  （REST，前端 vite.config.ts 的 /api proxy 打這個）
#   notification-service   -> localhost:8085  （WebSocket，前端直接連，gateway 不代理）
#   minio                  -> localhost:19000 （presigned URL 上傳用；本機 9000 常被別的東西佔用，
#                              所以固定用 19000，要跟 01-configmap.yaml 的 STORAGE_PUBLIC_ENDPOINT 對齊）
#
# 前景執行，佔用這個終端機；Ctrl-C 一次全部關閉。
# 對應的 pod 重啟過的話連線會斷，重跑這支腳本重開就好。
#
# 用法（./script.sh、bash script.sh、sh script.sh 都可以）：
#   ./infra/scripts/forward.sh
set -eu
cd "$(dirname "$0")"
. ./_env.sh

ensure_context

pids=""
cleanup() {
    echo
    echo "關閉 port-forward..."
    kill $pids 2>/dev/null || true
    wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

kubectl -n "$NAMESPACE" port-forward svc/gateway 8080:8080 &
pids="$pids $!"
kubectl -n "$NAMESPACE" port-forward svc/notification-service 8085:8085 &
pids="$pids $!"
kubectl -n "$NAMESPACE" port-forward svc/minio 19000:9000 &
pids="$pids $!"

echo
echo "gateway               http://localhost:8080"
echo "notification-service  ws://localhost:8085"
echo "minio                 http://localhost:19000"
echo
echo "Ctrl-C 結束全部 port-forward"

wait
