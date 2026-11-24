import { DockerTestSandbox } from "./docker-test-sandbox.js";

const MAX_OUTPUT = 1024 * 1024;

export function registerTestTools(registry, root, { testRunner } = {}) {
  const workspaceRoot = root;
  const sandbox = testRunner ?? new DockerTestSandbox();

  registry.register({
    id: "workspace.test",
    description: "Run the fixed Node.js test suite in an isolated Docker sandbox; requires trusted approval and never falls back to host execution.",
    requiresApproval: true,
    validateInput: input =>
      input !== null &&
      typeof input === "object" &&
      !Array.isArray(input) &&
      Object.keys(input).length === 0,
    execute: async () => {
      const result = await sandbox.run(workspaceRoot);
      if (!result || typeof result !== "object") {
        throw new Error("Sandbox runner returned an invalid result.");
      }
      const stdout = typeof result.stdout === "string" ? result.stdout.slice(0, MAX_OUTPUT / 2) : "";
      const stderr = typeof result.stderr === "string" ? result.stderr.slice(0, MAX_OUTPUT / 2) : "";
      return { ...result, stdout, stderr };
    }
  });
}
