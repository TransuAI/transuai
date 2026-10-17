#!/usr/bin/env bash
# 備份（見 docs/backup.md）：四個資料庫（pg_dump）、上傳的檔案（minio 的資料）、.env 與憑證，放在 backups/<時間>/。
# 服務不用停；備份時有人在上傳的話，那個檔案可能不完整（資料庫裡也還沒有它的紀錄）。
#
#   ./backup.sh [目的地目錄，預設 backups]
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "找不到 .env：這裡不是裝好的 TransuAI" >&2; exit 1; }
dest="${1:-backups}/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$dest"
chmod 700 "$dest"
dest=$(cd "$dest" && pwd)

echo "== 資料庫"
for db in auth_db upload_db transcription_db ai_db; do
    docker compose exec -T postgres sh -c "pg_dump -U \"\$POSTGRES_USER\" -Fc $db" > "$dest/$db.dump"
done

echo "== 上傳的檔案"
minio=$(docker compose ps -q minio)
[ -n "$minio" ] || { echo "minio 沒有在跑" >&2; exit 1; }
# minio 的 image 沒有 tar：用 postgres 的 image（compose 已經有了）掛同一個 volume 來打包。
docker run --rm --volumes-from "$minio" pgvector/pgvector:pg16 tar czf - -C /data . > "$dest/minio-data.tar.gz"

echo "== .env 與憑證"
cp .env "$dest/env"
[ -d tls ] && tar czf "$dest/tls.tar.gz" tls
chmod 600 "$dest"/*

du -sh "$dest"
echo "備份在 $dest（裡面有密鑰：只給管理這台的人讀，另外存一份在別台機器）"
