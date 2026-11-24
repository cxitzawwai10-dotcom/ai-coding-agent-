#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js and npm are required. In Termux run: pkg install nodejs npm"
  exit 1
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 24 ]; then
  echo "Node.js 24 or newer is required; found $(node --version)."
  echo "Update Termux packages with: pkg update && pkg upgrade && pkg install nodejs npm"
  exit 1
fi

echo "[1/4] Installing project dependencies..."
npm install --no-audit --no-fund

echo "[2/4] Creating private local secrets if needed..."
if [ ! -f .env ]; then npm run setup; fi
chmod 600 .env
mkdir -p .agent-data
chmod 700 .agent-data

ACCESS_TOKEN="$(sed -n 's/^AI_AGENT_ACCESS_TOKEN=//p' .env | tail -n 1)"
if [ "${#ACCESS_TOKEN}" -lt 32 ]; then
  echo "AI_AGENT_ACCESS_TOKEN is missing or too short in .env."
  exit 1
fi

echo "[3/4] Android local server is ready."
echo "Open this address in Chrome on the SAME Android phone:"
echo "http://127.0.0.1:8787"
echo
echo "Paste this local App Access Token into the browser page:"
echo "$ACCESS_TOKEN"
echo
echo "Keep Termux open while using the app. Press CTRL+C here to stop the server."
echo "[4/4] Starting AI Coding Agent..."
exec npm start
