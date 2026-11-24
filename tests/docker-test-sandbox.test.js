import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DockerTestSandbox } from "../src/tools/docker-test-sandbox.js";

test("Docker test sandbox applies isolation and resource constraints", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "docker-sandbox-"));
  let call;
  try {
    const sandbox = new DockerTestSandbox({
      exec: async (...args) => {
        call = args;
        return { stdout: "ok", stderr: "" };
      }
    });
    const result = await sandbox.run(root);
    assert.equal(result.passed, true);
    assert.equal(result.sandbox, "docker");
    assert.equal(call[0], "docker");
    const args = call[1];
    for (const required of [
      "--network=none", "--read-only", "--cap-drop=ALL",
      "--security-opt=no-new-privileges", "--pids-limit",
      "--memory", "--cpus", "--user", "--tmpfs"
    ]) assert.ok(args.includes(required), required);
    assert.ok(args.includes("--pull=never"));
    assert.ok(args.includes("readonly"));
    assert.ok(args.includes("node"));
    assert.ok(args.includes("--test"));
    assert.equal(call[2].shell, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Docker test sandbox fails closed when Docker is unavailable", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "docker-sandbox-missing-"));
  try {
    const sandbox = new DockerTestSandbox({
      exec: async () => { const error = new Error("missing"); error.code = "ENOENT"; throw error; }
    });
    const result = await sandbox.run(root);
    assert.equal(result.passed, false);
    assert.match(result.error, /unsandboxed fallback is disabled/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Docker sandbox rejects unsafe image references", () => {
  assert.throws(() => new DockerTestSandbox({ image: "node image; malicious" }), /Invalid sandbox image/);
});
