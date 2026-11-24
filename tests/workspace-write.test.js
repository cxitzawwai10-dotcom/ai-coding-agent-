import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkspaceTools } from "../src/tools/workspace-tools.js";

test("workspace write creates a new file", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-write-"));
  try {
    const workspace = new WorkspaceTools(root);
    await workspace.write("new.txt", "hello");
    assert.equal(await fs.readFile(path.join(root, "new.txt"), "utf8"), "hello");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("workspace write backs up an existing file", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-backup-"));
  try {
    await fs.writeFile(path.join(root, "note.txt"), "old content");
    const workspace = new WorkspaceTools(root);
    await workspace.write("note.txt", "new content");

    assert.equal(await fs.readFile(path.join(root, "note.txt"), "utf8"), "new content");
    const backups = await fs.readdir(path.join(root, ".agent-backups"));
    assert.equal(backups.length, 1);
    assert.equal(
      await fs.readFile(path.join(root, ".agent-backups", backups[0]), "utf8"),
      "old content"
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("workspace write rejects paths outside workspace", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-outside-"));
  try {
    const workspace = new WorkspaceTools(root);
    await assert.rejects(workspace.write("../outside.txt", "blocked"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
