import test from "node:test";
import assert from "node:assert/strict";
import { AgentCore } from "../src/agent/agent-core.js";

test("AgentCore initializes correctly", () => {
  const agent = new AgentCore();
  assert.equal(agent.getStatus(), "INITIALIZED");
});

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
