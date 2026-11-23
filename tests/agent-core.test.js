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
