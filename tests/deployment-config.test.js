import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("self-hosted VM service binds only to loopback and disables remote OAuth", async () => {
  const unit = await readFile(new URL("../deploy/systemd/ai-coding-agent.service", import.meta.url), "utf8");
  assert.match(unit, /Environment=AI_AGENT_HOST=127\.0\.0\.1/);
  assert.match(unit, /Environment=AI_AGENT_ALLOW_OAUTH=false/);
  assert.match(unit, /Environment=PORT=8787/);
  assert.match(unit, /NoNewPrivileges=true/);
  assert.match(unit, /ProtectSystem=strict/);
  assert.match(unit, /SupplementaryGroups=docker/);
});

test("Caddy template proxies HTTPS traffic to the loopback-only agent port", async () => {
  const caddy = await readFile(new URL("../deploy/caddy/Caddyfile.example", import.meta.url), "utf8");
  assert.match(caddy, /agent\.example\.com/);
  assert.match(caddy, /reverse_proxy 127\.0\.0\.1:8787/);
  assert.doesNotMatch(caddy, /reverse_proxy 0\.0\.0\.0/);
});

test("Termux startup script enforces supported Node.js and creates private local secrets", async () => {
  const script = await readFile(new URL("../scripts/termux-start.sh", import.meta.url), "utf8");
  assert.match(script, /NODE_MAJOR.*-lt 24/);
  assert.match(script, /npm install --no-audit --no-fund/);
  assert.match(script, /npm run setup/);
  assert.match(script, /chmod 600 \.env/);
  assert.match(script, /127\.0\.0\.1:8787/);
  assert.match(script, /exec npm start/);
});

test("Android quickstart documents same-device loopback OAuth and Termux runtime limits", async () => {
  const guide = await readFile(new URL("../docs/termux-android-quickstart.md", import.meta.url), "utf8");
  assert.match(guide, /pkg install -y git nodejs npm/);
  assert.match(guide, /127\.0\.0\.1:8787/);
  assert.match(guide, /same Android phone/);
  assert.match(guide, /Docker-based code execution/);
});
