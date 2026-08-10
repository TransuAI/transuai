#!/bin/bash
# 重新產生 Python gRPC stub：
#   - upload.proto（upload-service 的 InternalJobService，這個 repo 會呼叫它回寫 Job 狀態）
#   - transcription.proto（transcription-service 的 TranscriptionService，這個 repo 會呼叫它取得逐字稿）
#   - ai.proto（這個 repo 自己的 API 規格，供 Gateway 呼叫）
# proto 定義集中放在 ../infra/proto（供 upload-service / transcription-service / ai-service 共用），
# 產物有 commit 進版控，不用每個環境都拉 infra repo 才能跑。
set -euo pipefail

cd "$(dirname "$0")/.."

PROTO_DIR="../infra/proto"
OUT_DIR="app/proto_gen"

for proto in upload.proto transcription.proto ai.proto; do
    if [ ! -f "$PROTO_DIR/$proto" ]; then
        echo "找不到 $PROTO_DIR/$proto，請確認 infra repo 跟這個 repo 在同一層目錄" >&2
        exit 1
    fi
done

mkdir -p "$OUT_DIR"
touch "$OUT_DIR/__init__.py"

uv run python -m grpc_tools.protoc \
    -I "$PROTO_DIR" \
    --python_out="$OUT_DIR" \
    --grpc_python_out="$OUT_DIR" \
    --pyi_out="$OUT_DIR" \
    "$PROTO_DIR/upload.proto" "$PROTO_DIR/transcription.proto" "$PROTO_DIR/ai.proto"

# grpc_tools 產生的是絕對 import（import xxx_pb2），在 app.proto_gen 這個子套件底下會
# 找不到模組，改成套件內的相對 import。
#
# 另外產生出來的 servicer 靜態方法會用到 grpc.experimental.unary_unary，但單純 import grpc
# 不會讓 grpc.experimental 這個 submodule 變成可用的 attribute（無論是執行期或型別檢查都一樣，
# 要真的 import 過 grpc.experimental 才行），改成明確 import 讓兩邊都正確解析。
sed -i \
    -e 's/^import grpc$/import grpc\nimport grpc.experimental/' \
    -e 's/^import upload_pb2 as upload__pb2$/from . import upload_pb2 as upload__pb2/' \
    -e 's/^import transcription_pb2 as transcription__pb2$/from . import transcription_pb2 as transcription__pb2/' \
    -e 's/^import ai_pb2 as ai__pb2$/from . import ai_pb2 as ai__pb2/' \
    "$OUT_DIR/upload_pb2_grpc.py" "$OUT_DIR/transcription_pb2_grpc.py" "$OUT_DIR/ai_pb2_grpc.py"

echo "已產生 $OUT_DIR/{upload,transcription,ai}_pb2.py, {upload,transcription,ai}_pb2_grpc.py, *.pyi"
