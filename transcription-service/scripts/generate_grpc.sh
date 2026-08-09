#!/bin/bash
# 重新產生 Python gRPC stub：
#   - upload.proto（upload-service 的 InternalJobService，這個 repo 會呼叫它）
#   - transcription.proto（這個 repo自己的 API 規格，供 Gateway / AI Service 呼叫）
# proto 定義集中放在 ../infra/proto（供 transcription-service / upload-service 共用），
# 產物有 commit 進版控，不用每個環境都拉 infra repo 才能跑。
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

uv run python -m grpc_tools.protoc \
    -I "$PROTO_DIR" \
    --python_out="$OUT_DIR" \
    --grpc_python_out="$OUT_DIR" \
    --pyi_out="$OUT_DIR" \
    "$PROTO_DIR/transcription.proto"

# grpc_tools 產生的是絕對 import（import xxx_pb2），在 app.proto_gen 這個子套件底下會
# 找不到模組，改成套件內的相對 import。
sed -i \
    -e 's/^import upload_pb2 as upload__pb2$/from . import upload_pb2 as upload__pb2/' \
    -e 's/^import transcription_pb2 as transcription__pb2$/from . import transcription_pb2 as transcription__pb2/' \
    "$OUT_DIR/upload_pb2_grpc.py" "$OUT_DIR/transcription_pb2_grpc.py"

echo "已產生 $OUT_DIR/{upload,transcription}_pb2.py, {upload,transcription}_pb2_grpc.py, *.pyi"
