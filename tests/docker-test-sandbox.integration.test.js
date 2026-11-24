import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DockerTestSandbox } from "../src/tools/docker-test-sandbox.js";

test("real Docker sandbox executes tests with workspace isolated read-only", {
  skip: process.env.AI_AGENT_DOCKER_INTEGRATION !== "1"
}, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "docker-sandbox-integration-"));
  try {
    await fs.writeFile(
      path.join(root, "sample.test.js"),
      'import test from "node:test"; import assert from "node:assert/strict"; test("sandbox test", () => assert.equal(2 + 2, 4));'
    );
    const sandbox = new DockerTestSandbox();
    const result = await sandbox.run(root);
    assert.equal(result.passed, true, result.stderr || result.error || result.stdout);
    assert.equal(result.sandbox, "docker");
    assert.match(result.stdout, /pass 1/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
