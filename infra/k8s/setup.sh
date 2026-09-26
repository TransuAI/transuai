#!/bin/bash
# 一次把六個服務 + 基礎設施（Postgres/Redis/RabbitMQ/MinIO）跑在本機 Docker Desktop
# 內建的 Kubernetes（kind，三節點：desktop-control-plane/desktop-worker/desktop-worker2）上。
#
# 用法：
#   ./infra/k8s/setup.sh
#
# 前置需求：Docker Desktop 已開啟 Kubernetes、kubectl/kind CLI 可用。細節見 ../README.md。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
K8S_DIR="$ROOT_DIR/infra/k8s"
NAMESPACE=transuai
KIND_CLUSTER=desktop

echo "== 1/6 確認 kubectl context 是 docker-desktop =="
CURRENT_CONTEXT="$(kubectl config current-context)"
if [ "$CURRENT_CONTEXT" != "docker-desktop" ]; then
    if kubectl config get-contexts docker-desktop >/dev/null 2>&1; then
        echo "目前 context 是 '$CURRENT_CONTEXT'，切到 docker-desktop..."
        kubectl config use-context docker-desktop
    else
        echo "找不到 docker-desktop context，請確認 Docker Desktop 有開啟 Kubernetes。" >&2
        exit 1
    fi
fi
kubectl get nodes

echo "== 2/6 build 六個服務的 image =="
# Java 服務：build context 要是 repo 們的共同上層目錄（transuai/），因為
# build.gradle 用 srcDir '../infra/proto' 讀共用 proto 定義。
docker build -f "$ROOT_DIR/auth-service/Dockerfile" -t transuai/auth-service:dev "$ROOT_DIR"
docker build -f "$ROOT_DIR/gateway/Dockerfile" -t transuai/gateway:dev "$ROOT_DIR"
docker build -f "$ROOT_DIR/upload-service/Dockerfile" -t transuai/upload-service:dev "$ROOT_DIR"

# Python 服務：proto_gen 已 commit 進版控，context 是各自 repo 自己就夠。
docker build -t transuai/transcription-service:dev "$ROOT_DIR/transcription-service"
docker build -t transuai/ai-service:dev "$ROOT_DIR/ai-service"
docker build -t transuai/notification-service:dev "$ROOT_DIR/notification-service"

echo "== 3/6 把 image 載進 kind 叢集的每個節點 =="
# kind 每個節點各自有獨立 containerd image store，跟 host 的 docker image store 是分開的，
# 即使背後同一顆 Docker Engine 也不會自動同步，一定要用 kind load 明確載入，
# 不然 pod 會 ErrImageNeverPull（manifests 全部設 imagePullPolicy: Never，沒架 registry）。
for img in auth-service gateway upload-service transcription-service ai-service notification-service; do
    echo "loading transuai/$img:dev into kind cluster '$KIND_CLUSTER' ..."
    kind load docker-image "transuai/$img:dev" --name "$KIND_CLUSTER"
done

echo "== 4/6 套用 k8s manifests =="
kubectl apply -f "$K8S_DIR"

echo
echo "== 5/6 等待所有 Deployment/StatefulSet 就緒（可能要幾分鐘，Postgres/RabbitMQ/MinIO 第一次起會比較慢）=="
kubectl -n "$NAMESPACE" rollout status statefulset/postgres --timeout=300s
kubectl -n "$NAMESPACE" rollout status statefulset/rabbitmq --timeout=300s
kubectl -n "$NAMESPACE" rollout status statefulset/minio --timeout=300s
kubectl -n "$NAMESPACE" wait --for=condition=complete job/minio-init --timeout=120s
for d in auth-service upload-service transcription-service ai-service notification-service gateway; do
    kubectl -n "$NAMESPACE" rollout status deployment/"$d" --timeout=300s
done

echo
echo "== 6/6 狀態 =="
kubectl -n "$NAMESPACE" get pods

echo
echo "全部起來了。"
echo
echo "kind 節點只把 API server port 映射到 host，NodePort 30080 不會自動能連，"
echo "要從本機（localhost）打進去得自己開一條 port-forward（前景，斷線/pod 重啟要重開）："
echo "  kubectl -n transuai port-forward svc/gateway 30080:8080"
echo
echo "打通後可以測試（沒帶 token 預期回 401，代表服務有起來）："
echo "  curl -i http://localhost:30080/auth/me"
echo "  open http://localhost:30080/swagger-ui/index.html"
echo
echo "DEEPGRAM_API_KEY / HF_API_KEY / KEY_ENCRYPTION_KEY（還有要連結 Google 才需要的 GOOGLE_OAUTH_CLIENT_ID / _SECRET，見 README）還是空的，要補的話（不會印出 key 本身）："
echo '  kubectl -n transuai patch secret app-secrets --type merge -p "{\"stringData\":{\"DEEPGRAM_API_KEY\":\"$(cut -d= -f2 <<< "$(grep ^DEEPGRAM_API_KEY= ../transcription-service/.env)")\"}}"'
echo '  kubectl -n transuai patch secret app-secrets --type merge -p "{\"stringData\":{\"HF_API_KEY\":\"$(cut -d= -f2 <<< "$(grep ^HF_API_KEY= ../ai-service/.env)")\"}}"'
echo '  kubectl -n transuai patch secret app-secrets --type merge -p "{\"stringData\":{\"KEY_ENCRYPTION_KEY\":\"$(openssl rand -base64 32)\"}}"'
echo '  kubectl -n transuai rollout restart deployment transcription-service ai-service'
