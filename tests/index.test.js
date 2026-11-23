import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("AI Coding Agent starts successfully", () => {
  const result = spawnSync(
    process.execPath,
    ["src/index.js"],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /AI Coding Agent is starting/);
  assert.match(result.stdout, /Status: INITIALIZED/);
});
