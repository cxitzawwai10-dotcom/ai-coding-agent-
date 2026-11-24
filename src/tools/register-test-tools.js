import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 1024 * 1024;
const TEST_TIMEOUT_MS = 120_000;

function testEnvironment() {
  const env = { CI: "1" };
  if (process.env.PATH) env.PATH = process.env.PATH;
  if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR;
  if (process.platform === "win32") {
    for (const key of ["SystemRoot", "TEMP", "TMP"]) {
      if (process.env[key]) env[key] = process.env[key];
    }
  }
  return env;
}

export function registerTestTools(registry, root) {
  const workspaceRoot = path.resolve(root);

  registry.register({
    id: "workspace.test",
    description: "Run the fixed Node.js built-in test suite in the workspace; executes project test code and always requires trusted approval.",
    requiresApproval: true,
    validateInput: input =>
      input !== null &&
      typeof input === "object" &&
      !Array.isArray(input) &&
      Object.keys(input).length === 0,
    execute: async () => {
      const realRoot = await fs.realpath(workspaceRoot);
      const rootStat = await fs.stat(realRoot);
      if (!rootStat.isDirectory()) {
        throw new Error("Workspace test root is not a directory.");
      }

      try {
        const { stdout, stderr } = await execFileAsync(
          process.execPath,
          ["--test"],
          {
            cwd: realRoot,
            env: testEnvironment(),
            encoding: "utf8",
            timeout: TEST_TIMEOUT_MS,
            maxBuffer: Math.floor(MAX_OUTPUT / 2),
            windowsHide: true,
            shell: false
          }
        );
        return {
          passed: true,
          exitCode: 0,
          timedOut: false,
          stdout,
          stderr
        };
      } catch (error) {
        const timedOut = error?.code === "ETIMEDOUT" || error?.killed === true;
        return {
          passed: false,
          exitCode: Number.isInteger(error?.code) ? error.code : null,
          timedOut,
          stdout: typeof error?.stdout === "string" ? error.stdout : "",
          stderr: typeof error?.stderr === "string" ? error.stderr : "",
          error: timedOut
            ? "Workspace tests exceeded the 120-second time limit."
            : "Workspace tests failed or could not be started."
        };
      }
    }
  });
}
