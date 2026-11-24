import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentCore } from "../src/agent/agent-core.js";

test("AgentCore can use registered workspace tools", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-integration-"));
  try {
    await fs.writeFile(path.join(root, "story.txt"), "Hello workspace");
    const agent = new AgentCore();
    agent.attachWorkspace(root);

    const tools = agent.getTools();
    assert.ok(tools.some(tool => tool.id === "workspace.list"));
    assert.ok(tools.some(tool => tool.id === "workspace.read"));

    const content = await agent.executeTool("workspace.read", {
      path: "story.txt"
    });
    assert.equal(content, "Hello workspace");

    const entries = await agent.executeTool("workspace.list", {});
    assert.ok(entries.some(entry => entry.name === "story.txt"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("workspace tools reject paths outside workspace", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-integration-"));
  try {
    const agent = new AgentCore();
    agent.attachWorkspace(root);
    await assert.rejects(
      agent.executeTool("workspace.read", { path: "../outside.txt" })
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
