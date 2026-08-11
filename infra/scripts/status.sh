#!/bin/sh
# 快速看一下本機 local 開發用 k8s 叢集的狀態。
# 用法（./script.sh、bash script.sh、sh script.sh 都可以）：
#   ./infra/scripts/status.sh
set -eu
cd "$(dirname "$0")"
. ./_env.sh

echo "== kubectl context =="
kubectl config current-context

echo
echo "== nodes =="
kubectl get nodes

echo
echo "== pods ($NAMESPACE) =="
kubectl -n "$NAMESPACE" get pods

echo
echo "== 目前跑著的 port-forward =="
pgrep -fal "kubectl -n $NAMESPACE port-forward" || echo "（沒有，需要的話跑 ./forward.sh）"
