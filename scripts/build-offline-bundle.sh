#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
WORK_DIR="$ROOT_DIR/.offline-build"
SKILLS_DIR="$WORK_DIR/anthropic-skills"
EXPORT_DIR="$ROOT_DIR/deploy/export"
PG_CONTAINER="promptschat-offline-db"
PG_VOLUME="promptschat_offline_pgdata"
PG_PORT="${PG_PORT:-55432}"
POSTGRES_USER="${POSTGRES_USER:-prompts}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-prompts}"
POSTGRES_DB="${POSTGRES_DB:-prompts}"
APP_IMAGE="${APP_IMAGE:-promptschat-app:offline}"
DB_IMAGE="${DB_IMAGE:-promptschat-db:offline}"
SKILLS_REPO="${SKILLS_REPO:-https://github.com/anthropics/skills.git}"

DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${PG_PORT}/${POSTGRES_DB}?schema=public"
DIRECT_URL="$DATABASE_URL"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

cleanup() {
  docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

require_cmd docker
require_cmd git
require_cmd node
require_cmd npm
require_cmd npx

mkdir -p "$WORK_DIR" "$EXPORT_DIR"

cleanup

docker volume rm "$PG_VOLUME" >/dev/null 2>&1 || true

echo "[1/9] Starting temporary PostgreSQL container..."
docker run -d \
  --name "$PG_CONTAINER" \
  -e POSTGRES_USER="$POSTGRES_USER" \
  -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  -e POSTGRES_DB="$POSTGRES_DB" \
  -p "${PG_PORT}:5432" \
  -v "${PG_VOLUME}:/var/lib/postgresql/data" \
  postgres:17-bookworm >/dev/null

echo "[2/9] Waiting for PostgreSQL to accept connections..."
ATTEMPTS=0
until docker exec "$PG_CONTAINER" pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ "$ATTEMPTS" -ge 60 ]; then
    echo "Temporary PostgreSQL did not become ready in time." >&2
    exit 1
  fi
  sleep 2
done

echo "[3/9] Installing project dependencies..."
npm --prefix "$ROOT_DIR" ci

echo "[4/9] Applying schema migrations and seeding prompts..."
DATABASE_URL="$DATABASE_URL" DIRECT_URL="$DIRECT_URL" npx --yes --prefix "$ROOT_DIR" prisma migrate deploy
DATABASE_URL="$DATABASE_URL" DIRECT_URL="$DIRECT_URL" npm --prefix "$ROOT_DIR" run db:seed

echo "[5/9] Fetching latest Anthropic skills repository..."
rm -rf "$SKILLS_DIR"
git clone --depth 1 "$SKILLS_REPO" "$SKILLS_DIR"

echo "[6/9] Importing skills into the database..."
DATABASE_URL="$DATABASE_URL" DIRECT_URL="$DIRECT_URL" ANTHROPIC_SKILLS_DIR="$SKILLS_DIR/skills" npx --yes --prefix "$ROOT_DIR" tsx "$ROOT_DIR/scripts/seed-skills.ts" --all

echo "[7/9] Verifying prompt counts and exporting final database dump..."
docker exec "$PG_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c 'SELECT COUNT(*) AS prompt_count FROM "Prompt";'
docker exec "$PG_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c 'SELECT "type", COUNT(*) FROM "Prompt" GROUP BY "type" ORDER BY "type";'
docker exec "$PG_CONTAINER" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" > "$ROOT_DIR/prompts_data.sql"
cp "$ROOT_DIR/prompts_data.sql" "$EXPORT_DIR/prompts_data.sql"

echo "[8/9] Building offline deployment images..."
docker build -f "$ROOT_DIR/docker/Dockerfile" -t "$APP_IMAGE" "$ROOT_DIR"
docker build -f "$ROOT_DIR/docker/Dockerfile.db" -t "$DB_IMAGE" "$ROOT_DIR"

echo "[9/9] Exporting images for transfer..."
docker save -o "$EXPORT_DIR/promptschat-images-offline.tar" "$APP_IMAGE" "$DB_IMAGE"

echo

echo "Offline bundle created successfully."
echo "App image: $APP_IMAGE"
echo "DB image:  $DB_IMAGE"
echo "Dump file:  $EXPORT_DIR/prompts_data.sql"
echo "Image tar:  $EXPORT_DIR/promptschat-images-offline.tar"
