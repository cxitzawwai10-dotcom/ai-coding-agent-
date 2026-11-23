import test from "node:test";
import assert from "node:assert/strict";
import { TaskPlanner } from "../src/agent/task-planner.js";

test("TaskPlanner creates a valid plan", () => {
  const planner = new TaskPlanner();
  const result = planner.createPlan("Build an AI coding agent");

  assert.equal(result.status, "PLANNED");
  assert.equal(result.task, "Build an AI coding agent");
  assert.equal(result.steps.length, 6);
});

test("TaskPlanner trims task whitespace", () => {
  const planner = new TaskPlanner();
  const result = planner.createPlan("  Create a project  ");

  assert.equal(result.task, "Create a project");
});

test("TaskPlanner rejects an empty task", () => {
  const planner = new TaskPlanner();

  assert.throws(
    () => planner.createPlan(" "),
    /Task must be a non-empty string/
  );
});
