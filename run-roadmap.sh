#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi
exec npm run dev
