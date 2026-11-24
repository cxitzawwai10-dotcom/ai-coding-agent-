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
