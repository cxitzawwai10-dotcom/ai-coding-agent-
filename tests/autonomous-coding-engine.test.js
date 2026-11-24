import test from "node:test";
import assert from "node:assert/strict";
import { AutonomousCodingEngine } from "../src/agent/autonomous-coding-engine.js";

test("coding engine creates an approval-gated proposal from bounded JSON", async () => {
  const calls = [];
  const agent = {
    async processTask(task) { calls.push(["task", task]); return { taskId: "task-1", status: "RECEIVED" }; },
    async inspectTaskWorkspace(id, paths) { calls.push(["inspect", id, paths]); },
    prepareCodingChanges(id, files) { calls.push(["prepare", id, files]); return { changes: files.map(file => ({ path: file.path, requiresApproval: true })) }; },
    approveTask(id) { calls.push(["approve", id]); return { status: "WAITING_FOR_APPROVAL" }; }
  };
  const providerClient = { async generate(input) { calls.push(["generate", input]); return { text: JSON.stringify({ files: [{ path: "src/a.js", content: "export const a = 1;" }] }) }; } };
  const result = await new AutonomousCodingEngine({ agent, providerClient }).createProposal({ task: "Add a constant" });
  assert.equal(result.approvalRequired, true);
  assert.equal(result.status, "WAITING_FOR_APPROVAL");
  assert.deepEqual(calls.map(call => call[0]), ["task", "generate", "inspect", "prepare", "approve"]);
});

test("coding engine rejects malformed proposals before approval", async () => {
  const agent = { async processTask() { return { taskId: "task-2", status: "RECEIVED" }; } };
  const engine = new AutonomousCodingEngine({ agent, providerClient: { async generate() { return { text: '{"files":[]}' }; } } });
  await assert.rejects(engine.createProposal({ task: "bad" }), /1-20/);
});
