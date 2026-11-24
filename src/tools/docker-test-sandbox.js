import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 1024 * 1024;
const TIMEOUT_MS = 120_000;
const DEFAULT_IMAGE = "node:24-alpine";

function boundedInteger(value, fallback, min, max) {
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

export class DockerTestSandbox {
  constructor({
    image = DEFAULT_IMAGE,
    timeoutMs = TIMEOUT_MS,
    memory = "512m",
    cpus = "1",
    pidsLimit = 64,
    exec = execFileAsync
  } = {}) {
    if (typeof image !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,200}$/.test(image)) {
      throw new Error("Invalid sandbox image reference.");
    }
    this.image = image;
    this.timeoutMs = boundedInteger(timeoutMs, TIMEOUT_MS, 1000, TIMEOUT_MS);
    this.memory = memory;
    this.cpus = cpus;
    this.pidsLimit = boundedInteger(pidsLimit, 64, 16, 256);
    this.exec = exec;
  }

  async run(workspaceRoot) {
    const realRoot = await fs.realpath(path.resolve(workspaceRoot));
    const rootStat = await fs.stat(realRoot);
    if (!rootStat.isDirectory()) throw new Error("Workspace test root is not a directory.");

    const args = [
      "run", "--rm",
      "--pull=never",
      "--network=none",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--pids-limit", String(this.pidsLimit),
      "--memory", this.memory,
      "--cpus", this.cpus,
      "--user", "65532:65532",
      "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m",
      "--mount", `type=bind,src=${realRoot},dst=/workspace,readonly`,
      "--workdir", "/workspace",
      this.image,
      "node", "--test"
    ];

    try {
      const { stdout, stderr } = await this.exec("docker", args, {
        encoding: "utf8",
        timeout: this.timeoutMs,
        maxBuffer: Math.floor(MAX_OUTPUT / 2),
        windowsHide: true,
        shell: false,
        env: process.platform === "win32"
          ? { SystemRoot: process.env.SystemRoot ?? "" }
          : { PATH: process.env.PATH ?? "/usr/bin:/bin" }
      });
      return { passed: true, exitCode: 0, timedOut: false, stdout, stderr, sandbox: "docker" };
    } catch (error) {
      const timedOut = error?.code === "ETIMEDOUT" || error?.killed === true;
      const output = {
        passed: false,
        exitCode: Number.isInteger(error?.code) ? error.code : null,
        timedOut,
        stdout: typeof error?.stdout === "string" ? error.stdout : "",
        stderr: typeof error?.stderr === "string" ? error.stderr : "",
        sandbox: "docker"
      };
      if (error?.code === "ENOENT") {
        output.error = "Docker is unavailable. Tests were not run; unsandboxed fallback is disabled.";
      } else if (timedOut) {
        output.error = "Sandboxed workspace tests exceeded the 120-second time limit.";
      } else {
        output.error = "Sandboxed workspace tests failed or the required image is unavailable. No unsandboxed fallback was attempted.";
      }
      return output;
    }
  }
}
