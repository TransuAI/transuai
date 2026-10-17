#!/bin/sh
# 改了某個服務的程式碼之後用這個：重新 build image -> kind load 進叢集 -> 重啟 deployment。
# （imagePullPolicy: Never，同一個 tag:dev 不會自動抓新版，一定要手動跑完這三步。）
#
# 用法（./script.sh、bash script.sh、sh script.sh 都可以）：
#   ./infra/scripts/rebuild.sh <service> [service...]
#   ./infra/scripts/rebuild.sh --all
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

for service in $services; do
    case " $all_services " in
        *" $service "*) ;;
        *)
            echo "不認得的 service：$service（可用：$all_services）" >&2
            exit 1
            ;;
    esac
done

ensure_context

for service in $services; do
    echo "== build transuai/$service:dev =="
    docker_build "$service"
    echo "== kind load $service 進叢集 '$KIND_CLUSTER' =="
    kind load docker-image "transuai/$service:dev" --name "$KIND_CLUSTER"
done

for service in $services; do
    echo "== 重啟 $service =="
    kubectl -n "$NAMESPACE" rollout restart "deployment/$service"
done

for service in $services; do
    kubectl -n "$NAMESPACE" rollout status "deployment/$service" --timeout=300s
done
