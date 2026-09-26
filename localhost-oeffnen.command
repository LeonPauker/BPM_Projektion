#!/bin/zsh
set -e

cd "$(dirname "$0")"

if ! lsof -iTCP:3000 -sTCP:LISTEN -t >/dev/null 2>&1; then
  npm start > /tmp/bpm-projektion-server.log 2>&1 &
fi

until lsof -iTCP:3000 -sTCP:LISTEN -t >/dev/null 2>&1; do
  sleep 0.1
done

open "http://localhost:3000"