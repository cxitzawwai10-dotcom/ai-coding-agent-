import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentCore } from "../src/agent/agent-core.js";

test("workspace write requires a separate explicit approval step", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "approval-integration-"));
  try {
    await fs.writeFile(path.join(root, "note.txt"), "original");
    const agent = new AgentCore();
    agent.attachWorkspace(root);
    const input = { path: "note.txt", content: "updated" };
    await assert.rejects(agent.executeTool("workspace.write", input), /Trusted approval is required/);
    const request = agent.requestToolApproval("workspace.write", input);
    assert.equal(request.toolId, "workspace.write");
    assert.equal(typeof request.requestId, "string");
    await assert.rejects(agent.executeTool("workspace.write", input), /Trusted approval is required/);
    const token = agent.approveToolRequest(request.requestId);
    const result = await agent.executeTool("workspace.write", input, { approvalToken: token });
    assert.equal(result.written, true);
    assert.equal(await fs.readFile(path.join(root, "note.txt"), "utf8"), "updated");
    await assert.rejects(agent.executeTool("workspace.write", input, { approvalToken: token }), /Trusted approval is required/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rejected workspace write request cannot authorize execution", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "approval-rejected-"));
  try {
    const agent = new AgentCore();
    agent.attachWorkspace(root);
    const input = { path: "blocked.txt", content: "no" };
    const request = agent.requestToolApproval("workspace.write", input);
    assert.equal(agent.rejectToolRequest(request.requestId), true);
    assert.throws(() => agent.approveToolRequest(request.requestId), /not found or expired/);
    await assert.rejects(agent.executeTool("workspace.write", input), /Trusted approval is required/);
    await assert.rejects(fs.access(path.join(root, "blocked.txt")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
