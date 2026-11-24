import { test } from "node:test";
import assert from "node:assert/strict";
import { ApprovalManager } from "../src/safety/approval-manager.js";

test("approval requires an explicit approve step and token works once", () => {
  const manager = new ApprovalManager();
  const input = { path: "a.txt", content: "hello" };
  const request = manager.request("workspace.write", input);

  assert.equal(typeof request.requestId, "string");
  assert.equal(
    manager.verify("workspace.write", input, {}),
    false
  );

  const token = manager.approve(request.requestId);

  assert.equal(
    manager.verify("workspace.write", input, { approvalToken: token }),
    true
  );
  assert.equal(
    manager.verify("workspace.write", input, { approvalToken: token }),
    false
  );
});

test("approval token cannot authorize a different input", () => {
  const manager = new ApprovalManager();
  const request = manager.request("workspace.write", { path: "a.txt" });
  const token = manager.approve(request.requestId);

  assert.equal(
    manager.verify("workspace.write", { path: "b.txt" }, { approvalToken: token }),
    false
  );
});

test("expired approval request cannot be approved", async () => {
  const manager = new ApprovalManager({ ttlMs: 1 });
  const request = manager.request("workspace.write", { path: "a.txt" });

  await new Promise(resolve => setTimeout(resolve, 10));

  assert.throws(
    () => manager.approve(request.requestId),
    /expired/
  );
});

test("rejected approval request cannot produce a token", () => {
  const manager = new ApprovalManager();
  const request = manager.request("workspace.write", { path: "a.txt" });

  assert.equal(manager.reject(request.requestId), true);
  assert.throws(
    () => manager.approve(request.requestId),
    /not found or expired/
  );
});
