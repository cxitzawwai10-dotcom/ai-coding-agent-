import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { ApprovalManager } from "../src/safety/approval-manager.js";
import { WorkspaceTools } from "../src/tools/workspace-tools.js";
import { executeToolWithCliConsent } from "../src/ui/approval-cli.js";

test("write rejects dangling symlink targets", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hardening-dangling-"));
  const outside = path.join(os.tmpdir(), `outside-${Date.now()}-${Math.random()}`);
  try {
    await fs.symlink(outside, path.join(root, "escape.txt"));
    await assert.rejects(new WorkspaceTools(root).write("escape.txt", "outside"), /symbolic|symlink/i);
    await assert.rejects(fs.access(outside));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { force: true });
  }
});

test("write rejects a symlink backup directory without modifying original", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hardening-backup-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "hardening-outside-"));
  try {
    await fs.writeFile(path.join(root, "note.txt"), "original");
    await fs.symlink(outside, path.join(root, ".agent-backups"));
    await assert.rejects(new WorkspaceTools(root).write("note.txt", "changed"), /backup directory/i);
    assert.equal(await fs.readFile(path.join(root, "note.txt"), "utf8"), "original");
    assert.deepEqual(await fs.readdir(outside), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("write rejects symlink parent components", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hardening-parent-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "hardening-parent-out-"));
  try {
    await fs.symlink(outside, path.join(root, "linked"));
    await assert.rejects(new WorkspaceTools(root).write("linked/new.txt", "blocked"), /outside workspace|symlink/i);
    await assert.rejects(fs.access(path.join(outside, "new.txt")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("read enforces the 1 MB limit", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hardening-read-"));
  try {
    await fs.writeFile(path.join(root, "large.txt"), "x".repeat(1024 * 1024 + 1));
    await assert.rejects(new WorkspaceTools(root).read("large.txt"), /exceeds 1 MB/i);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("approval manager removes expired records", async () => {
  const manager = new ApprovalManager({ ttlMs: 10 });
  const request = manager.request("workspace.write", { path: "a.txt" });
  const token = manager.approve(request.requestId);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(manager.verify("workspace.write", { path: "a.txt" }, { approvalToken: token }), false);
  assert.equal(manager.tokens.size, 0);
  const pending = manager.request("workspace.write", { path: "b.txt" });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.throws(() => manager.approve(pending.requestId), /not found or expired/i);
  assert.equal(manager.pending.size, 0);
});

test("approval manager enforces pending request capacity", () => {
  const manager = new ApprovalManager({ maxPending: 1 });
  manager.request("workspace.write", { path: "a.txt" });
  assert.throws(() => manager.request("workspace.write", { path: "b.txt" }), /too many pending/i);
});

test("CLI executes the exact approval snapshot, not later caller mutations", async () => {
  const calls = [];
  const input = { path: "note.txt", content: "approved" };
  const agent = {
    getTools: () => [{ id: "workspace.write", requiresApproval: true }],
    requestToolApproval: (id, value) => ({ requestId: "snapshot-test", toolId: id, input: structuredClone(value) }),
    approveToolRequest: () => "approval-token",
    rejectToolRequest: () => true,
    executeTool: async (id, value, options) => { calls.push({ id, value, options }); return "ok"; }
  };
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const run = executeToolWithCliConsent(agent, "workspace.write", input, { stdin, stdout });
  input.content = "changed after request";
  stdin.end("y\n");
  await run;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].value.content, "approved");
  assert.equal(calls[0].options.approvalToken, "approval-token");
});

test("CLI clears pending approval when input ends unexpectedly", async () => {
  let rejected = 0;
  const agent = {
    getTools: () => [{ id: "workspace.write", requiresApproval: true }],
    requestToolApproval: (id, input) => ({ requestId: "eof-test", toolId: id, input: structuredClone(input) }),
    approveToolRequest: () => { throw new Error("Must not approve on EOF"); },
    rejectToolRequest: id => { assert.equal(id, "eof-test"); rejected++; return true; },
    executeTool: async () => { throw new Error("Must not execute on EOF"); }
  };
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const run = executeToolWithCliConsent(agent, "workspace.write", { path: "note.txt", content: "hello" }, { stdin, stdout });
  stdin.end();
  await assert.rejects(run);
  assert.equal(rejected, 1);
});
