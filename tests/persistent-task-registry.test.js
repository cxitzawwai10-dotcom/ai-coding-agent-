import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PersistentTaskRegistry } from "../src/agent/persistent-task-registry.js";
import { AgentCore } from "../src/agent/agent-core.js";
import { TASK_STATES } from "../src/agent/task-lifecycle.js";

async function fixture() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "agent-task-persistence-"));
  return { root, filePath: path.join(root, "tasks.json"), cleanup: () => fsp.rm(root, { recursive: true, force: true }) };
}

test("PersistentTaskRegistry restores task records and ID sequence after restart", async () => {
  const f = await fixture();
  try {
    const first = new PersistentTaskRegistry({ filePath: f.filePath });
    const task = first.create("Persist this task");
    first.update(task.id, { status: TASK_STATES.PLANNED, result: { steps: ["inspect"] } });
    const restarted = new PersistentTaskRegistry({ filePath: f.filePath });
    assert.equal(restarted.get(task.id).status, TASK_STATES.PLANNED);
    assert.equal(restarted.get(task.id).result.steps[0], "inspect");
    assert.equal(restarted.create("Second task").id, "task-2");
  } finally { await f.cleanup(); }
});

test("PersistentTaskRegistry rejects corrupt JSON and symlink store files", async () => {
  const f = await fixture();
  try {
    fs.writeFileSync(f.filePath, "{invalid");
    assert.throws(() => new PersistentTaskRegistry({ filePath: f.filePath }), /invalid JSON/i);
    await fsp.unlink(f.filePath);
    const target = path.join(f.root, "target.json");
    await fsp.writeFile(target, JSON.stringify({ version: 1, nextId: 1, tasks: [] }));
    await fsp.symlink(target, f.filePath);
    assert.throws(() => new PersistentTaskRegistry({ filePath: f.filePath }));
  } finally { await f.cleanup(); }
});

test("AgentCore restores task lifecycle and resumes a planned task after restart", async () => {
  const f = await fixture();
  try {
    const first = new AgentCore(undefined, new PersistentTaskRegistry({ filePath: f.filePath }));
    const task = await first.processTask("Resume after restart");
    const restarted = new AgentCore(undefined, new PersistentTaskRegistry({ filePath: f.filePath }));
    assert.equal(restarted.getTask(task.taskId).status, TASK_STATES.PLANNED);
    const approval = restarted.approveTask(task.taskId);
    assert.equal(approval.status, TASK_STATES.WAITING_FOR_APPROVAL);
    const result = await restarted.executeTask(task.taskId, async () => "resumed");
    assert.equal(result.status, TASK_STATES.COMPLETED);
    const finalRegistry = new PersistentTaskRegistry({ filePath: f.filePath });
    assert.equal(finalRegistry.get(task.taskId).status, TASK_STATES.COMPLETED);
  } finally { await f.cleanup(); }
});

test("AgentCore marks interrupted executing tasks failed on restart", async () => {
  const f = await fixture();
  try {
    const registry = new PersistentTaskRegistry({ filePath: f.filePath });
    const task = registry.create("Interrupted task");
    registry.update(task.id, { status: TASK_STATES.PLANNED });
    registry.update(task.id, { status: TASK_STATES.WAITING_FOR_APPROVAL });
    registry.update(task.id, { status: TASK_STATES.EXECUTING });
    const restarted = new AgentCore(undefined, new PersistentTaskRegistry({ filePath: f.filePath }));
    const restored = restarted.getTask(task.id);
    assert.equal(restored.status, TASK_STATES.FAILED);
    assert.match(restored.error, /interrupted by an application restart/i);
  } finally { await f.cleanup(); }
});
