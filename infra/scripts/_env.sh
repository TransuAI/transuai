# 共用變數，被這個目錄下其他腳本用 `.` source。不要直接執行。
# 純 POSIX sh 語法（不用 bashism），呼叫端要先 cd 進 infra/scripts 再 source 這支。
ROOT_DIR="$(cd ../.. && pwd)"
K8S_DIR="$ROOT_DIR/infra/k8s"
NAMESPACE=transuai
KIND_CLUSTER=desktop

# service 名稱 -> docker build 指令用的參數，跟 k8s/setup.sh 保持一致。
# Java 服務（build.gradle 用 srcDir '../infra/proto'）build context 要是 ROOT_DIR；
# Python 服務 proto_gen 已 commit 進版控，context 是各自 repo 目錄就夠。
java_services="auth-service gateway upload-service"
python_services="transcription-service ai-service notification-service"
all_services="auth-service gateway upload-service transcription-service ai-service notification-service"

docker_build() {
    service="$1"
    case " $java_services " in
        *" $service "*)
            docker build -f "$ROOT_DIR/$service/Dockerfile" -t "transuai/$service:dev" "$ROOT_DIR"
            ;;
        *)
            docker build -t "transuai/$service:dev" "$ROOT_DIR/$service"
            ;;
    esac
}

ensure_context() {
    current="$(kubectl config current-context)"
    if [ "$current" != "docker-desktop" ]; then
        echo "目前 kubectl context 是 '$current'，切到 docker-desktop..." >&2
        kubectl config use-context docker-desktop
    fi
}
