import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkspaceTools } from "../src/tools/workspace-tools.js";


test("workspace file identity check distinguishes replacement files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-identity-"));
  try {
    const first = path.join(root, "first.txt");
    const hardlink = path.join(root, "first-link.txt");
    const second = path.join(root, "second.txt");
    await fs.writeFile(first, "same inode");
    await fs.link(first, hardlink);
    await fs.writeFile(second, "different inode");
    const workspace = new WorkspaceTools(root);
    const firstStat = await fs.stat(first);
    const linkStat = await fs.stat(hardlink);
    const secondStat = await fs.stat(second);
    assert.equal(workspace.sameFile(firstStat, linkStat), true);
    assert.equal(workspace.sameFile(firstStat, secondStat), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("workspace read rejects symlinks pointing outside workspace", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-link-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "outside-link-"));
  try {
    await fs.writeFile(path.join(outside, "secret.txt"), "secret");
    await fs.symlink(path.join(outside, "secret.txt"), path.join(root, "escape.txt"));
    const workspace = new WorkspaceTools(root);
    await assert.rejects(workspace.read("escape.txt"), /outside workspace|symbolic links are not allowed/i);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("workspace write rejects symlink directories outside workspace", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-link-dir-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "outside-link-dir-"));
  try {
    await fs.symlink(outside, path.join(root, "external"));
    const workspace = new WorkspaceTools(root);
    await assert.rejects(
      workspace.write("external/new.txt", "blocked"),
      /outside workspace/
    );
    await assert.rejects(fs.access(path.join(outside, "new.txt")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("workspace write rejects content larger than 1 MB", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-large-"));
  try {
    const workspace = new WorkspaceTools(root);
    await assert.rejects(
      workspace.write("large.txt", "x".repeat(1024 * 1024 + 1)),
      /exceeds 1 MB/
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
