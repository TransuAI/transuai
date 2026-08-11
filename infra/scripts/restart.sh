#!/bin/sh
# 改了 infra/k8s/01-configmap.yaml 或 02-secret.yaml 之後用這個：套用最新設定，
# 重啟指定的 deployment 讓它重新讀一次環境變數（k8s 的 ConfigMap/Secret 改了不會自動讓
# 正在跑的 pod 感知到，一定要 rollout restart）。
#
# 用法（./script.sh、bash script.sh、sh script.sh 都可以）：
#   ./infra/scripts/restart.sh <service> [service...]
#   ./infra/scripts/restart.sh --all
#
# 只改了程式碼、沒改 configmap/secret 的話用 rebuild.sh，不是這支。
set -eu
cd "$(dirname "$0")"
. ./_env.sh

if [ "$#" -eq 0 ]; then
    echo "用法：$0 <service> [service...]  或  $0 --all" >&2
    echo "可用 service：$all_services" >&2
    exit 1
fi

if [ "$1" = "--all" ]; then
    services="$all_services"
else
    services="$*"
fi

ensure_context

echo "== 套用 configmap / secret =="
kubectl apply -f "$K8S_DIR/01-configmap.yaml" -f "$K8S_DIR/02-secret.yaml"

for service in $services; do
    case " $all_services " in
        *" $service "*) ;;
        *)
            echo "不認得的 service：$service（可用：$all_services）" >&2
            exit 1
            ;;
    esac
    echo "== 重啟 $service =="
    kubectl -n "$NAMESPACE" rollout restart "deployment/$service"
done

for service in $services; do
    kubectl -n "$NAMESPACE" rollout status "deployment/$service" --timeout=120s
done
