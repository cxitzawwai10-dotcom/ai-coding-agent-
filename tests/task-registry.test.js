import test from "node:test";
import assert from "node:assert/strict";
import { TaskRegistry } from "../src/agent/task-registry.js";

test("TaskRegistry creates tasks with unique IDs and RECEIVED status", () => {
  const registry = new TaskRegistry();
  const first = registry.create("First task");
  const second = registry.create("Second task");

  assert.equal(first.id, "task-1");
  assert.equal(second.id, "task-2");
  assert.equal(first.status, "RECEIVED");
  assert.equal(first.task, "First task");
});

test("TaskRegistry rejects an empty task", () => {
  const registry = new TaskRegistry();
  assert.throws(() => registry.create(" "), /non-empty string/);
});

test("TaskRegistry gets existing tasks and handles unknown IDs", () => {
  const registry = new TaskRegistry();
  const created = registry.create("Find me");

  assert.equal(registry.get(created.id).task, "Find me");
  assert.equal(registry.get("missing"), null);
});

test("TaskRegistry lists all stored tasks", () => {
  const registry = new TaskRegistry();
  registry.create("First");
  registry.create("Second");

  assert.equal(registry.list().length, 2);
});

test("TaskRegistry updates task status and result", () => {
  const registry = new TaskRegistry();
  const created = registry.create("Plan a task");
  const updated = registry.update(created.id, {
    status: "PLANNED",
    result: { steps: ["Plan"] }
  });

  assert.equal(updated.status, "PLANNED");
  assert.deepEqual(updated.result, { steps: ["Plan"] });
});

test("TaskRegistry protects stored records from external mutation", () => {
  const registry = new TaskRegistry();
  const created = registry.create("Protected");
  created.status = "CORRUPTED";

  assert.equal(registry.get(created.id).status, "RECEIVED");
});

test("TaskRegistry rejects unknown tasks and unsupported fields", () => {
  const registry = new TaskRegistry();
  const created = registry.create("Valid");

  assert.throws(
    () => registry.update("missing", { status: "FAILED" }),
    /Task not found/
  );

  assert.throws(
    () => registry.update(created.id, { task: "Changed" }),
    /Unsupported task field/
  );
});

test("TaskRegistry filters tasks by status", () => {
  const registry = new TaskRegistry();
  const first = registry.create("First");
  registry.create("Second");
  registry.update(first.id, { status: "PLANNED" });

  const planned = registry.filterByStatus("PLANNED");

  assert.equal(planned.length, 1);
  assert.equal(planned[0].id, first.id);
});

test("TaskRegistry returns an accurate status summary", () => {
  const registry = new TaskRegistry();
  const first = registry.create("First");
  registry.create("Second");
  registry.update(first.id, { status: "PLANNED" });

  assert.deepEqual(registry.getSummary(), {
    total: 2,
    byStatus: {
      PLANNED: 1,
      RECEIVED: 1
    }
  });
});

test("TaskRegistry records status changes in task history", () => {
  const registry = new TaskRegistry();
  const created = registry.create("Track history");

  const updated = registry.update(created.id, {
    status: "PLANNED"
  });

  assert.equal(updated.history.length, 2);
  assert.equal(updated.history[0].status, "RECEIVED");
  assert.equal(updated.history[1].status, "PLANNED");
  assert.equal(updated.history[1].previousStatus, "RECEIVED");
});

test("TaskRegistry protects history from external mutation", () => {
  const registry = new TaskRegistry();
  const created = registry.create("Protected history");

  created.history.push({ status: "CORRUPTED" });

  assert.equal(registry.get(created.id).history.length, 1);
});

test("TaskRegistry deletes existing tasks", () => {
  const registry = new TaskRegistry();
  const created = registry.create("Delete me");

  assert.equal(registry.delete(created.id), true);
  assert.equal(registry.get(created.id), null);
  assert.equal(registry.delete(created.id), false);
});

test("TaskRegistry rejects invalid status filters and updates", () => {
  const registry = new TaskRegistry();
  const created = registry.create("Validate");

  assert.throws(
    () => registry.filterByStatus(" "),
    /Status must be a non-empty string/
  );

  assert.throws(
    () => registry.update(created.id, { status: " " }),
    /Status must be a non-empty string/
  );
});
