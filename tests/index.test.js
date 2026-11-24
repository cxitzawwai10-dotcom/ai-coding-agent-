import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAgent } from "../src/index.js";

test("AI Coding Agent starts successfully", () => {
  const result = spawnSync(
    process.execPath,
    ["src/index.js"],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /AI Coding Agent is starting/);
  assert.match(result.stdout, /Status: INITIALIZED/);
  assert.match(result.stdout, /workspace\.list/);
  assert.match(result.stdout, /workspace\.read/);
  assert.match(result.stdout, /workspace\.write/);
});

test("App entry connects AgentCore to workspace tools", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "ai-agent-entry-")
  );

  try {
    const { agent, workspaceRoot, projectManager, projectMemory, dataRoot, taskRegistry } = createAgent({
      workspaceRoot: root,
      dataRoot: path.join(root, "agent-state")
    });

    assert.equal(workspaceRoot, root);
    assert.equal(dataRoot, path.join(root, "agent-state"));
    assert.ok(projectManager);
    assert.ok(projectMemory);
    assert.ok(taskRegistry);
    const created = await agent.processTask("Persist from app factory");
    const restarted = createAgent({ workspaceRoot: root, dataRoot: path.join(root, "agent-state") });
    assert.equal(restarted.agent.getTask(created.taskId).status, "PLANNED");

    const ids = agent.getTools().map(tool => tool.id);

    assert.ok(ids.includes("workspace.list"));
    assert.ok(ids.includes("workspace.read"));
    assert.ok(ids.includes("workspace.write"));

    assert.equal(
      agent.getTools().find(
        tool => tool.id === "workspace.write"
      ).requiresApproval,
      true
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test("primary CLI entry requires explicit consent before workspace writes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-agent-cli-consent-"));
  try {
    const input = JSON.stringify({ path: "denied.txt", content: "must not write" });
    const denied = spawnSync(
      process.execPath,
      [path.resolve("src/index.js"), "--tool", "workspace.write", "--input", input],
      { cwd: root, encoding: "utf8", input: "n\n" }
    );
    assert.equal(denied.status, 0, denied.stderr);
    assert.match(denied.stdout, /TOOL APPROVAL REQUIRED/);
    assert.match(denied.stdout, /Description: Write or update a workspace file/);
    assert.match(denied.stdout, /DENIED/);
    await assert.rejects(import("node:fs/promises").then(fs => fs.access(path.join(root, "denied.txt"))));
    
    const approvedInput = JSON.stringify({ path: "approved.txt", content: "approved content" });
    const approved = spawnSync(
      process.execPath,
      [path.resolve("src/index.js"), "--tool", "workspace.write", "--input", approvedInput],
      { cwd: root, encoding: "utf8", input: "y\n" }
    );
    assert.equal(approved.status, 0, approved.stderr);
    assert.match(approved.stdout, /APPROVED/);
    assert.equal(await (await import("node:fs/promises")).readFile(path.join(root, "approved.txt"), "utf8"), "approved content");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
