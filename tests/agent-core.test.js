import test from "node:test";
import assert from "node:assert/strict";
import { AgentCore } from "../src/agent/agent-core.js";
import { TASK_STATES } from "../src/agent/task-lifecycle.js";

test("AgentCore receives a valid task", async () => {
  const agent = new AgentCore();
  const result = await agent.processTask("Create a test project");

  assert.equal(result.task, "Create a test project");
  assert.equal(result.status, "RECEIVED");
});

test("AgentCore rejects an empty task", async () => {
  const agent = new AgentCore();

  await assert.rejects(
    agent.processTask(" "),
    /Task must be a non-empty string/
  );
});

test("AgentCore integrates with TaskPlanner", async () => {
  const agent = new AgentCore();
  const result = await agent.processTask("Build an AI coding agent");

  assert.equal(result.status, "RECEIVED");
  assert.equal(result.plan.status, "PLANNED");
  assert.equal(result.plan.steps.length, 6);
});

test("AgentCore handles planner errors safely", async () => {
  const failingPlanner = {
    createPlan() {
      throw new Error("Planner failure");
    }
  };

  const agent = new AgentCore(failingPlanner);
  const result = await agent.processTask("Build an application");

  assert.equal(result.status, "FAILED");
  assert.equal(result.error, "Planner failure");
  assert.equal(result.lifecycle.state, "FAILED");
  assert.deepEqual(result.lifecycle.history, ["RECEIVED", "FAILED"]);
});

test("AgentCore registers successfully planned tasks", async () => {
  const agent = new AgentCore();
  const result = await agent.processTask("Create a registered task");
  const record = agent.registry.get(result.taskId);

  assert.equal(record.task, "Create a registered task");
  assert.equal(record.status, "PLANNED");
  assert.deepEqual(record.result, result.plan);
});

test("AgentCore registers failed tasks with their error", async () => {
  const failingPlanner = {
    createPlan() {
      throw new Error("Registry failure test");
    }
  };

  const agent = new AgentCore(failingPlanner);
  const result = await agent.processTask("Register a failed task");
  const record = agent.registry.get(result.taskId);

  assert.equal(record.status, "FAILED");
  assert.equal(record.error, "Registry failure test");
});

test("AgentCore exposes task lookup, filtering, summary, and deletion", async () => {
  const agent = new AgentCore();

  const first = await agent.processTask("First registered task");
  const second = await agent.processTask("Second registered task");

  assert.equal(agent.getTask(first.taskId).task, "First registered task");
  assert.equal(agent.getTasks().length, 2);
  assert.equal(agent.getTasks({ status: "PLANNED" }).length, 2);
  assert.equal(agent.getTaskSummary().total, 2);
  assert.equal(agent.deleteTask(second.taskId), true);
  assert.equal(agent.getTask(second.taskId), null);
  assert.equal(agent.getTaskSummary().total, 1);
});

test("AgentCore requires approval before execution", async () => {
  const agent = new AgentCore();
  const task = await agent.processTask("Protected task");

  await assert.rejects(
    agent.executeTask(task.taskId),
    /Task requires approval/
  );

  assert.equal(agent.getTask(task.taskId).status, TASK_STATES.PLANNED);
});

test("AgentCore approves a task before execution", async () => {
  const agent = new AgentCore();
  const task = await agent.processTask("Approval test");

  const approval = agent.approveTask(task.taskId);

  assert.equal(approval.status, TASK_STATES.WAITING_FOR_APPROVAL);
  assert.deepEqual(approval.lifecycle.history, [
    TASK_STATES.RECEIVED,
    TASK_STATES.PLANNED,
    TASK_STATES.WAITING_FOR_APPROVAL
  ]);
});

test("AgentCore rejects a task without executing it", async () => {
  let executed = false;
  const agent = new AgentCore(undefined, undefined, async () => {
    executed = true;
  });

  const task = await agent.processTask("Reject test");
  agent.approveTask(task.taskId);

  const result = agent.rejectTask(task.taskId, "User rejected");

  assert.equal(result.status, TASK_STATES.FAILED);
  assert.equal(result.error, "User rejected");
  assert.equal(executed, false);
});

test("AgentCore executes an approved task successfully", async () => {
  const agent = new AgentCore();
  const task = await agent.processTask("Execute test");

  agent.approveTask(task.taskId);

  const result = await agent.executeTask(task.taskId, async context => {
    assert.equal(context.task, "Execute test");
    assert.equal(context.plan.status, "PLANNED");
    return "Execution successful";
  });

  assert.equal(result.status, TASK_STATES.COMPLETED);
  assert.equal(result.result, "Execution successful");
  assert.deepEqual(result.lifecycle.history, [
    "RECEIVED",
    "PLANNED",
    "WAITING_FOR_APPROVAL",
    "EXECUTING",
    "COMPLETED"
  ]);
});

test("AgentCore records execution failures", async () => {
  const agent = new AgentCore();
  const task = await agent.processTask("Execution failure test");

  agent.approveTask(task.taskId);

  const result = await agent.executeTask(task.taskId, async () => {
    throw new Error("Executor failure");
  });

  assert.equal(result.status, TASK_STATES.FAILED);
  assert.equal(result.error, "Executor failure");
  assert.equal(agent.getTask(task.taskId).status, TASK_STATES.FAILED);
});

test("AgentCore refuses execution without a valid executor", async () => {
  const agent = new AgentCore();
  const task = await agent.processTask("Missing executor test");

  agent.approveTask(task.taskId);

  await assert.rejects(
    agent.executeTask(task.taskId),
    /valid task executor is required/
  );

  assert.equal(
    agent.getTask(task.taskId).status,
    TASK_STATES.WAITING_FOR_APPROVAL
  );
});

test("AgentCore executes registered tools sequentially within an approved task", async () => {
  const order = [];
  const agent = new AgentCore();
  agent.registerTool({
    id: "prepare",
    description: "Prepare a resource",
    execute: async input => { order.push("prepare"); return `prepared:${input.value}`; }
  });
  agent.registerTool({
    id: "finish",
    description: "Finish the resource",
    execute: async input => { order.push("finish"); return `finished:${input.value}`; }
  });

  const task = await agent.processTask("Run a two-step tool workflow");
  agent.approveTask(task.taskId);
  const result = await agent.executeToolSequence(task.taskId, [
    { toolId: "prepare", input: { value: "item" } },
    { toolId: "finish", input: { value: "item" } }
  ]);

  assert.deepEqual(order, ["prepare", "finish"]);
  assert.equal(result.status, TASK_STATES.COMPLETED);
  assert.equal(result.result.stepsCompleted, 2);
  assert.deepEqual(result.result.results.map(item => item.result), [
    "prepared:item",
    "finished:item"
  ]);
});

test("AgentCore validates the complete tool sequence before executing any step", async () => {
  let executions = 0;
  const agent = new AgentCore();
  agent.registerTool({
    id: "safe",
    description: "Safe test tool",
    execute: async () => { executions += 1; return true; }
  });
  const task = await agent.processTask("Reject invalid workflow");
  agent.approveTask(task.taskId);

  await assert.rejects(
    agent.executeToolSequence(task.taskId, [
      { toolId: "safe", input: {} },
      { toolId: "missing", input: {} }
    ]),
    /Unknown tool in sequence/
  );
  assert.equal(executions, 0);
  assert.equal(agent.getTask(task.taskId).status, TASK_STATES.WAITING_FOR_APPROVAL);
});

test("AgentCore stops a tool sequence after a tool fails", async () => {
  const order = [];
  const agent = new AgentCore();
  agent.registerTool({
    id: "break",
    description: "Failing tool",
    execute: async () => { order.push("break"); throw new Error("step failed"); }
  });
  agent.registerTool({
    id: "never",
    description: "Must not run",
    execute: async () => { order.push("never"); }
  });
  const task = await agent.processTask("Stop on tool error");
  agent.approveTask(task.taskId);

  const result = await agent.executeToolSequence(task.taskId, [
    { toolId: "break", input: {} },
    { toolId: "never", input: {} }
  ]);

  assert.equal(result.status, TASK_STATES.FAILED);
  assert.equal(result.error, "step failed");
  assert.deepEqual(order, ["break"]);
});
