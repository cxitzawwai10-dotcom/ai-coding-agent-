import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const setupPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../scripts/setup.js");

test("first-run setup creates independent strong secrets without overwriting existing configuration", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-setup-"));
  try {
    const first = spawnSync(process.execPath, [setupPath], {cwd:dir,encoding:"utf8"});
    assert.equal(first.status,0,first.stderr);
    const envPath=path.join(dir,".env");
    const content=await readFile(envPath,"utf8");
    const vault=content.match(/^AI_AGENT_VAULT_KEY=(.+)$/m)?.[1];
    const access=content.match(/^AI_AGENT_ACCESS_TOKEN=(.+)$/m)?.[1];
    assert.ok(vault && vault.length>=32);
    assert.ok(access && access.length>=32);
    assert.notEqual(vault,access);
    assert.equal((await stat(envPath)).mode & 0o777,0o600);
    const second=spawnSync(process.execPath,[setupPath],{cwd:dir,encoding:"utf8"});
    assert.equal(second.status,1);
    assert.match(second.stderr,/already exists/);
    assert.equal(await readFile(envPath,"utf8"),content);
  } finally {
    await rm(dir,{recursive:true,force:true});
  }
});
