#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
    CREATE DATABASE auth_db;
    CREATE DATABASE upload_db;
    CREATE DATABASE transcription_db;
    CREATE DATABASE ai_db;
EOSQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "ai_db" <<-EOSQL
    CREATE EXTENSION IF NOT EXISTS vector;
EOSQL