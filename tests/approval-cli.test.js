import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { executeToolWithCliConsent } from "../src/ui/approval-cli.js";
import { ApprovalManager } from "../src/safety/approval-manager.js";

function createAgent() {
  const calls = [];
  const agent = {
    calls,
    rejected: [],
    getTools: () => [{ id: "workspace.write", description: "Write a file in the workspace.", requiresApproval: true }],
    requestToolApproval: (id, input) => ({ requestId: "request-1", toolId: id, input }),
    approveToolRequest: () => "one-time-token",
    rejectToolRequest: requestId => { agent.rejected.push(requestId); return true; },
    executeTool: async (id, input, options) => {
      calls.push({ id, input, options });
      return "written";
    }
  };
  return agent;
}

test("CLI consent denies execution unless user enters y", async () => {
  const agent = createAgent();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let output = "";
  stdout.on("data", chunk => { output += chunk.toString(); });
  const run = executeToolWithCliConsent(agent, "workspace.write", { path: "note.txt", content: "secret" }, { stdin, stdout });
  stdin.end("n\n");
  const result = await run;
  assert.deepEqual(result, { approved: false, executed: false });
  assert.equal(agent.calls.length, 0);
  assert.match(output, /DENIED/);
});

test("CLI consent executes with one-time token after y", async () => {
  const agent = createAgent();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const run = executeToolWithCliConsent(agent, "workspace.write", { path: "note.txt", content: "hello" }, { stdin, stdout });
  stdin.end("y\n");
  const result = await run;
  assert.equal(result.approved, true);
  assert.equal(result.executed, true);
  assert.equal(agent.calls.length, 1);
  assert.equal(agent.calls[0].options.approvalToken, "one-time-token");
});

test("approval request input is isolated from caller mutation", () => {
  const manager = new ApprovalManager();
  const input = { path: "note.txt", nested: { value: 1 } };
  const request = manager.request("workspace.write", input);
  input.nested.value = 99;
  request.input.nested.value = 55;
  const token = manager.approve(request.requestId);
  assert.equal(manager.verify("workspace.write", { path: "note.txt", nested: {value: 1} }, { approvalToken: token }), true);
});


test("CLI consent denies and clears pending request when stdin reaches EOF", async () => {
  const agent = createAgent();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const run = executeToolWithCliConsent(agent, "workspace.write", { path: "note.txt", content: "no" }, { stdin, stdout });
  stdin.end();
  await assert.rejects(run, /input ended before a response/);
  assert.equal(agent.calls.length, 0);
  assert.deepEqual(agent.rejected, ["request-1"]);
});
