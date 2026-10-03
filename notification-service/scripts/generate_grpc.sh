#!/bin/bash
# 重新產生 Python gRPC stub：只有 upload.proto（upload-service 的 UploadService.GetJob，訂閱 WebSocket 時用來確認 Job 是這位使用者的）。
# proto 定義集中放在 ../infra/proto，產物有 commit 進版控，不用每個環境都拉 infra repo 才能跑（跟 ai-service 一樣）。
set -euo pipefail

cd "$(dirname "$0")/.."

PROTO_DIR="../infra/proto"
OUT_DIR="app/proto_gen"

if [ ! -f "$PROTO_DIR/upload.proto" ]; then
    echo "找不到 $PROTO_DIR/upload.proto，請確認 infra repo 跟這個 repo 在同一層目錄" >&2
    exit 1
fi

mkdir -p "$OUT_DIR"
touch "$OUT_DIR/__init__.py"

uv run python -m grpc_tools.protoc \
    -I "$PROTO_DIR" \
    --python_out="$OUT_DIR" \
    --grpc_python_out="$OUT_DIR" \
    --pyi_out="$OUT_DIR" \
    "$PROTO_DIR/upload.proto"

# grpc_tools 產生的是絕對 import（import upload_pb2），在 app.proto_gen 這個子套件底下找不到，改成套件內的相對 import；
# grpc.experimental 要明確 import 才能用（見 ai-service/scripts/generate_grpc.sh）。
sed -i \
    -e 's/^import grpc$/import grpc\nimport grpc.experimental/' \
    -e 's/^import upload_pb2 as upload__pb2$/from . import upload_pb2 as upload__pb2/' \
    "$OUT_DIR/upload_pb2_grpc.py"

echo "已產生 $OUT_DIR/upload_pb2.py, upload_pb2_grpc.py, upload_pb2.pyi"
