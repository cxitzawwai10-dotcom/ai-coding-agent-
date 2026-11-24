import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonStore } from "../src/storage/json-store.js";
import { ProjectManager } from "../src/projects/project-manager.js";
import { ProjectMemory } from "../src/memory/project-memory.js";

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-phase3-"));
  return { root, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

test("JsonStore persists structured data and returns independent values", async () => {
  const f = await fixture();
  try {
    const store = new JsonStore(path.join(f.root, "state.json"));
    const value = { version: 1, nested: { value: 7 } };
    await store.write(value);
    value.nested.value = 99;
    const loaded = await store.read({});
    assert.equal(loaded.nested.value, 7);
    loaded.nested.value = 12;
    assert.equal((await store.read({})).nested.value, 7);
  } finally { await f.cleanup(); }
});

test("JsonStore serializes concurrent writes and rejects corrupt JSON", async () => {
  const f = await fixture();
  try {
    const file = path.join(f.root, "state.json");
    const store = new JsonStore(file);
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.write({ value: i })));
    assert.ok(Number.isInteger((await store.read({})).value));
    await fs.writeFile(file, "{broken");
    await assert.rejects(store.read({}), /invalid JSON/i);
  } finally { await f.cleanup(); }
});

test("ProjectManager creates, lists, updates, reloads and removes projects", async () => {
  const f = await fixture();
  try {
    const storePath = path.join(f.root, "projects.json");
    const manager = new ProjectManager({ storePath });
    const project = await manager.create({ name: "Story tool", root: path.join(f.root, "story"), description: "Story generator" });
    assert.equal((await manager.get(project.id)).name, "Story tool");
    const updated = await manager.update(project.id, { name: "Story Creator" });
    assert.equal(updated.name, "Story Creator");
    const restarted = new ProjectManager({ storePath });
    assert.equal((await restarted.list()).length, 1);
    assert.equal(await restarted.remove(project.id), true);
    assert.equal(await restarted.get(project.id), null);
    assert.equal(await restarted.remove(project.id), false);
  } finally { await f.cleanup(); }
});

test("ProjectManager rejects duplicate roots, invalid fields and excessive data", async () => {
  const f = await fixture();
  try {
    const manager = new ProjectManager({ storePath: path.join(f.root, "projects.json") });
    await manager.create({ name: "One", root: path.join(f.root, "workspace") });
    await assert.rejects(manager.create({ name: "Two", root: path.join(f.root, "workspace") }), /already uses/);
    await assert.rejects(manager.update("missing", { root: "/tmp" }), /Only project name and description/);
    await assert.rejects(manager.create({ name: "", root: path.join(f.root, "other") }), /Project name/);
  } finally { await f.cleanup(); }
});

test("ProjectMemory persists notes, decisions, tags, search and deletion", async () => {
  const f = await fixture();
  try {
    const storePath = path.join(f.root, "memory.json");
    const memory = new ProjectMemory({ storePath });
    const note = await memory.add("project-1", { content: "Use Gemini for story generation", type: "decision", tags: ["AI", "Provider"] });
    await memory.add("project-1", { content: "Implement mobile layout", type: "task", tags: ["ui"] });
    const restarted = new ProjectMemory({ storePath });
    assert.equal((await restarted.list("project-1")).length, 2);
    assert.equal((await restarted.search("project-1", "gemini"))[0].id, note.id);
    assert.equal((await restarted.search("project-1", "provider"))[0].id, note.id);
    assert.equal(await restarted.remove("project-1", note.id), true);
    assert.equal((await restarted.list("project-1")).length, 1);
  } finally { await f.cleanup(); }
});

test("ProjectMemory validates limits and isolates project records", async () => {
  const f = await fixture();
  try {
    const memory = new ProjectMemory({ storePath: path.join(f.root, "memory.json") });
    await memory.add("a", { content: "A only" });
    await memory.add("b", { content: "B only" });
    assert.equal((await memory.list("a")).length, 1);
    await assert.rejects(memory.add("a", { content: "" }), /content/);
    await assert.rejects(memory.list("a", { limit: 0 }), /limit/);
    assert.equal(await memory.clear("a"), 1);
    assert.equal((await memory.list("a")).length, 0);
    assert.equal((await memory.list("b")).length, 1);
  } finally { await f.cleanup(); }
});
