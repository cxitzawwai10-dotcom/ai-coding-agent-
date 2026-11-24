import { test } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "../src/tools/tool-registry.js";

test("registers and lists tools", () => {
  const registry = new ToolRegistry();
  registry.register({ id: "hello", description: "Hello tool", execute: async () => "ok" });
  assert.equal(registry.get("hello").description, "Hello tool");
  assert.equal(registry.list().length, 1);
});

test("rejects duplicate tool IDs", () => {
  const registry = new ToolRegistry();
  const tool = { id: "hello", description: "Hello", execute: async () => "ok" };
  registry.register(tool);
  assert.throws(() => registry.register(tool), /already registered/);
});

test("executes an ordinary tool", async () => {
  const registry = new ToolRegistry();
  registry.register({ id: "hello", description: "Hello", execute: async input => input });
  assert.equal(await registry.execute("hello", "ok"), "ok");
});

test("blocks protected tools without trusted approval", async () => {
  const registry = new ToolRegistry();
  registry.register({ id: "write", description: "Write file", requiresApproval: true, execute: async () => "written" });
  await assert.rejects(registry.execute("write", {}, { approved: true }), /Trusted approval/);
});

test("allows protected tools only when verifier approves", async () => {
  const registry = new ToolRegistry(async (id, input, options) => options.token === "trusted-token");
  registry.register({ id: "write", description: "Write file", requiresApproval: true, execute: async () => "written" });
  assert.equal(await registry.execute("write", {}, { token: "trusted-token" }), "written");
});

test("rejects invalid tool input", async () => {
  const registry = new ToolRegistry();
  registry.register({ id: "hello", description: "Hello", validateInput: () => false, execute: async () => "ok" });
  await assert.rejects(registry.execute("hello", {}), /validation failed/);
});

test("unregisters tools", () => {
  const registry = new ToolRegistry();
  registry.register({ id: "hello", description: "Hello", execute: async () => "ok" });
  assert.equal(registry.unregister("hello"), true);
  assert.equal(registry.get("hello"), null);
});
