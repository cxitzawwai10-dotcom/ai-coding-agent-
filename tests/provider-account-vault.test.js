import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AccountVault } from "../src/providers/account-vault.js";

test("account vault encrypts credentials and supports any configured account count", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "provider-vault-"));
  try {
    const filePath = path.join(root, "accounts.json");
    const vault = new AccountVault({ filePath, masterSecret: "a-test-master-secret-at-least-32-chars" });
    const added = await Promise.all(Array.from({ length: 5 }, (_, i) => vault.addAccount({ provider: "gemini", label: `Gemini ${i}`, apiKey: `secret-key-${i}-long` })));
    assert.equal((await vault.listAccounts()).length, 5);
    assert.equal((await vault.getActiveAccount()).apiKey, "secret-key-0-long");
    const disk = await readFile(filePath, "utf8");
    assert.doesNotMatch(disk, /secret-key-/);
    assert.equal(added.length, 5);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("daily quota cooldown persists for 24 hours and disables active selection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "provider-cooldown-"));
  try {
    let now = Date.parse("2026-01-01T00:00:00.000Z");
    const filePath = path.join(root, "accounts.json");
    const options = { filePath, masterSecret: "a-test-master-secret-at-least-32-chars", clock: () => now };
    const vault = new AccountVault(options);
    const account = await vault.addAccount({ provider: "gemini", label: "main", apiKey: "secret-key-long" });
    await vault.markDailyQuotaExceeded(account.id);
    await assert.rejects(vault.getActiveAccount(), /No active AI provider account/);
    const restarted = new AccountVault(options);
    await assert.rejects(restarted.selectAccount(account.id), /cooldown/);
    now += 24 * 60 * 60 * 1000;
    await restarted.clearExpiredCooldowns();
    await restarted.selectAccount(account.id);
    assert.equal((await restarted.getActiveAccount()).apiKey, "secret-key-long");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("vault requires a strong master secret", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "provider-secret-"));
  try {
    const vault = new AccountVault({ filePath: path.join(root, "accounts.json"), masterSecret: "short" });
    await assert.rejects(vault.listAccounts(), /at least 32/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
