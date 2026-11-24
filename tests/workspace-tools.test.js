import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkspaceTools } from "../src/tools/workspace-tools.js";

test("lists workspace entries", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-"));
  try {
    await fs.writeFile(path.join(root, "hello.txt"), "hello");
    const tools = new WorkspaceTools(root);
    const entries = await tools.list();
    assert.ok(entries.some(item => item.name === "hello.txt"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("reads a workspace file", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-"));
  try {
    await fs.writeFile(path.join(root, "hello.txt"), "hello");
    const tools = new WorkspaceTools(root);
    assert.equal(await tools.read("hello.txt"), "hello");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rejects paths outside workspace", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-"));
  try {
    const tools = new WorkspaceTools(root);
    await assert.rejects(tools.read("../outside.txt"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
