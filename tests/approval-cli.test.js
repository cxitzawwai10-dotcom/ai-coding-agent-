import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { executeToolWithCliConsent } from "../src/ui/approval-cli.js";
import { ApprovalManager } from "../src/safety/approval-manager.js";

function createAgent() {
  const calls = [];
  return {
    calls,
    getTools: () => [{ id: "workspace.write", requiresApproval: true }],
    requestToolApproval: (id, input) => ({ requestId: "request-1", toolId: id, input }),
    approveToolRequest: () => "one-time-token",
    rejectToolRequest: () => true,
    executeTool: async (id, input, options) => {
      calls.push({ id, input, options });
      return "written";
    }
  };
}

test("CLI consent denies execution unless user enters y", async () => {
  const agent = createAgent();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let output = "";
  stdout.on("data", chunk => { output += chunk.toString(); });
  stdin.end("n\n");
  const result = await executeToolWithCliConsent(agent, "workspace.write", { path: "note.txt", content: "secret" }, { stdin, stdout });
  assert.deepEqual(result, { approved: false, executed: false });
  assert.equal(agent.calls.length, 0);
  assert.match(output, /DENIED/);
});

test("CLI consent executes with one-time token after y", async () => {
  const agent = createAgent();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  stdin.end("y\n");
  const result = await executeToolWithCliConsent(agent, "workspace.write", { path: "note.txt", content: "hello" }, { stdin, stdout });
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
