#!/usr/bin/env bash
# Checks that the local API can reach PostgreSQL and Redis.
set -euo pipefail

API_URL="${API_URL:-http://localhost:3000}"
curl -fsS "${API_URL}/api/v1/health" && echo
