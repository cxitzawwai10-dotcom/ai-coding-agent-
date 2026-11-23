import test from "node:test";
import assert from "node:assert/strict";
import { TaskLifecycle, TASK_STATES } from "../src/agent/task-lifecycle.js";

test("TaskLifecycle starts in RECEIVED state", () => {
  const lifecycle = new TaskLifecycle();
  assert.equal(lifecycle.getState(), TASK_STATES.RECEIVED);
});

test("TaskLifecycle follows a valid state sequence", () => {
  const lifecycle = new TaskLifecycle();

  lifecycle.transition(TASK_STATES.PLANNED);
  lifecycle.transition(TASK_STATES.WAITING_FOR_APPROVAL);
  lifecycle.transition(TASK_STATES.EXECUTING);
  lifecycle.transition(TASK_STATES.COMPLETED);

  assert.equal(lifecycle.getState(), TASK_STATES.COMPLETED);
  assert.equal(lifecycle.getHistory().length, 5);
});

test("TaskLifecycle rejects an invalid transition", () => {
  const lifecycle = new TaskLifecycle();

  assert.throws(
    () => lifecycle.transition(TASK_STATES.COMPLETED),
    /Invalid task transition/
  );
});

test("TaskLifecycle protects its history", () => {
  const lifecycle = new TaskLifecycle();
  const history = lifecycle.getHistory();

  history.push("UNKNOWN");

  assert.deepEqual(lifecycle.getHistory(), [TASK_STATES.RECEIVED]);
});

test("TaskLifecycle rejects an invalid initial state", () => {
  assert.throws(
    () => new TaskLifecycle("UNKNOWN"),
    /Invalid initial task state/
  );
});
