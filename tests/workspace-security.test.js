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

test("workspace concurrent writes never publish partial file contents", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-concurrent-write-"));
  try {
    const workspace = new WorkspaceTools(root);
    const candidates = Array.from({ length: 12 }, (_, index) =>
      `writer-${index}-${"x".repeat(32 * 1024)}`
    );

    const results = await Promise.allSettled(
      candidates.map(content => workspace.write("shared.txt", content))
    );

    assert.ok(results.some(result => result.status === "fulfilled"));
    const finalContent = await fs.readFile(path.join(root, "shared.txt"), "utf8");
    assert.ok(candidates.includes(finalContent), "final file must equal one complete writer payload");

    const entries = await fs.readdir(root);
    assert.ok(!entries.some(name => name.startsWith(".agent-") && name.endsWith(".tmp")),
      "temporary files must be cleaned up after concurrent writes");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("workspace write backup preserves the complete previous file", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-backup-content-"));
  try {
    const target = path.join(root, "existing.txt");
    const previousContent = "original content that must remain recoverable";
    await fs.writeFile(target, previousContent);

    const workspace = new WorkspaceTools(root);
    await workspace.write("existing.txt", "replacement content");

    assert.equal(await fs.readFile(target, "utf8"), "replacement content");
    const backupDir = path.join(root, ".agent-backups");
    const backups = (await fs.readdir(backupDir)).filter(name => name.endsWith(".bak"));
    assert.equal(backups.length, 1);
    assert.equal(await fs.readFile(path.join(backupDir, backups[0]), "utf8"), previousContent);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
