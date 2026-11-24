import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

test("AgentCore inspects workspace files before approved coding execution", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-task-inspect-"));
  try {
    await fs.writeFile(path.join(root, "source.js"), "export const value = 1;");
    const agent = new AgentCore();
    agent.attachWorkspace(root);
    const task = await agent.processTask("Update source.js safely");

    const inspection = await agent.inspectTaskWorkspace(task.taskId, ["source.js"]);
    assert.equal(inspection.inspectedFiles, 1);
    assert.equal(inspection.files[0].content, "export const value = 1;");

    agent.approveTask(task.taskId);
    const executed = await agent.executeTask(task.taskId, async context => {
      assert.equal(context.plan.workspaceInspection[0].path, "source.js");
      assert.equal(context.plan.workspaceInspection[0].content, "export const value = 1;");
      return "inspection context verified";
    });
    assert.equal(executed.status, TASK_STATES.COMPLETED);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("AgentCore rejects workspace inspection for unplanned tasks and invalid paths", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-task-inspect-invalid-"));
  try {
    const agent = new AgentCore();
    agent.attachWorkspace(root);
    const task = await agent.processTask("Inspect safely");
    await assert.rejects(
      agent.inspectTaskWorkspace(task.taskId, [""]),
      /unique non-empty strings/
    );
    agent.approveTask(task.taskId);
    await assert.rejects(
      agent.inspectTaskWorkspace(task.taskId, ["missing.js"]),
      /only allowed for planned tasks/
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("AgentCore prepares inspected coding changes and applies each with trusted approval", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-coding-plan-"));
  try {
    await fs.writeFile(path.join(root, "source.js"), "export const oldValue = 1;");
    const agent = new AgentCore();
    agent.attachWorkspace(root);
    const task = await agent.processTask("Update source.js and add a note");
    await agent.inspectTaskWorkspace(task.taskId, ["source.js"]);
    const proposal = agent.prepareCodingChanges(task.taskId, [
      { path: "source.js", content: "export const newValue = 2;" },
      { path: "notes.txt", content: "Updated safely." }
    ]);
    assert.equal(proposal.changes.length, 2);
    agent.approveTask(task.taskId);

    const changes = agent.getTask(task.taskId).result.proposedChanges;
    const tokens = changes.map(change => {
      const request = agent.requestToolApproval("workspace.write", change);
      return agent.approveToolRequest(request.requestId);
    });
    const result = await agent.executeCodingChanges(task.taskId, tokens);
    assert.equal(result.status, TASK_STATES.COMPLETED);
    assert.equal(result.result.changesApplied, 2);
    assert.match(result.result.verification, /not requested/);
    assert.equal(await fs.readFile(path.join(root, "source.js"), "utf8"), "export const newValue = 2;");
    assert.equal(await fs.readFile(path.join(root, "notes.txt"), "utf8"), "Updated safely.");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("AgentCore refuses coding changes without inspection or per-file approval tokens", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-coding-plan-deny-"));
  try {
    const agent = new AgentCore();
    agent.attachWorkspace(root);
    const task = await agent.processTask("Write a file");
    assert.throws(
      () => agent.prepareCodingChanges(task.taskId, [{ path: "x.txt", content: "x" }]),
      /Inspect workspace files/
    );
    await agent.inspectTaskWorkspace(task.taskId, ["missing.txt"]).catch(() => {});
    assert.throws(
      () => agent.prepareCodingChanges(task.taskId, [{ path: "x.txt", content: "x" }]),
      /Inspect workspace files/
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});


test("AgentCore runs Node workspace tests only with trusted approval after coding changes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-coding-test-pass-"));
  try {
    await fs.writeFile(path.join(root, "source.js"), "export const value = 1;\n");
    await fs.writeFile(
      path.join(root, "source.test.js"),
      'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { value } from "./source.js";\ntest("updated source value", () => assert.equal(value, 2));\n'
    );
    const agent = new AgentCore();
    agent.attachWorkspace(root);
    const task = await agent.processTask("Update source and run tests");
    await agent.inspectTaskWorkspace(task.taskId, ["source.js", "source.test.js"]);
    agent.prepareCodingChanges(task.taskId, [
      { path: "source.js", content: "export const value = 2;\n" }
    ]);
    agent.approveTask(task.taskId);

    const change = agent.getTask(task.taskId).result.proposedChanges[0];
    const writeRequest = agent.requestToolApproval("workspace.write", change);
    const writeToken = agent.approveToolRequest(writeRequest.requestId);
    const testRequest = agent.requestToolApproval("workspace.test", {});
    const testToken = agent.approveToolRequest(testRequest.requestId);

    await assert.rejects(
      agent.executeCodingChanges(task.taskId, [writeToken], ""),
      /trusted approval token is required/
    );
    assert.equal(
      await fs.readFile(path.join(root, "source.js"), "utf8"),
      "export const value = 1;\n"
    );

    const result = await agent.executeCodingChanges(task.taskId, [writeToken], testToken);
    assert.equal(result.status, TASK_STATES.COMPLETED);
    assert.equal(result.result.tests.passed, true);
    assert.equal(result.result.tests.exitCode, 0);
    assert.match(result.result.verification, /All workspace tests passed/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("AgentCore marks coding execution failed when approved workspace tests fail", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-coding-test-fail-"));
  try {
    await fs.writeFile(path.join(root, "source.js"), "export const value = 1;\n");
    await fs.writeFile(
      path.join(root, "source.test.js"),
      'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { value } from "./source.js";\ntest("expected value", () => assert.equal(value, 99));\n'
    );
    const agent = new AgentCore();
    agent.attachWorkspace(root);
    const task = await agent.processTask("Run failing project tests");
    await agent.inspectTaskWorkspace(task.taskId, ["source.js", "source.test.js"]);
    agent.prepareCodingChanges(task.taskId, [
      { path: "source.js", content: "export const value = 2;\n" }
    ]);
    agent.approveTask(task.taskId);

    const change = agent.getTask(task.taskId).result.proposedChanges[0];
    const writeRequest = agent.requestToolApproval("workspace.write", change);
    const writeToken = agent.approveToolRequest(writeRequest.requestId);
    const testRequest = agent.requestToolApproval("workspace.test", {});
    const testToken = agent.approveToolRequest(testRequest.requestId);

    const result = await agent.executeCodingChanges(task.taskId, [writeToken], testToken);
    assert.equal(result.status, TASK_STATES.FAILED);
    assert.match(result.error, /Workspace tests failed/);
    assert.equal(await fs.readFile(path.join(root, "source.js"), "utf8"), "export const value = 1;\n");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
