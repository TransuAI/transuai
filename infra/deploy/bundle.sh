#!/usr/bin/env bash
# 離線安裝包（不能連外的環境）：在能連外的機器上把 compose.yaml 用到的所有 image 存成一個 tar，連同這個目錄帶進去，
#   ./install.sh --images load:transuai-images.tar
# 先在這台準備好 image（./install.sh 或 docker compose pull／build）。模型伺服器另外部署，見 docs/offline.md。
#
#   ./bundle.sh [輸出檔，預設 transuai-images.tar]
set -euo pipefail
cd "$(dirname "$0")"

out="${1:-transuai-images.tar}"
# compose 讀 .env（image 的 registry 與版本）；還沒安裝過的話用範本。
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp compose.yaml "$work/"
if [ -f .env ]; then cp .env "$work/.env"; else cp .env.example "$work/.env"; fi
mapfile -t images < <(docker compose --project-directory "$work" -f "$work/compose.yaml" config --images | sort -u)

for image in "${images[@]}"; do
    docker image inspect "$image" >/dev/null 2>&1 || docker pull "$image"
done
echo "存成 $out：${images[*]}"
docker save -o "$out" "${images[@]}"
ls -lh "$out"
