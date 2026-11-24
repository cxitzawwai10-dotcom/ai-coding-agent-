import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 1024 * 1024;
const TIMEOUT_MS = 120_000;
const MAX_FILES = 20_000;
const MAX_STAGED_BYTES = 250 * 1024 * 1024;
const DEFAULT_IMAGE = "node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5";
const SECRET_NAME = /^(\.env($|\.)|.*(secret|credential|token|api[-_]?key|private[-_]?key).*$|.*\.(pem|key|p12|pfx|jks)$)/i;
const OMIT_DIRS = new Set([".git", ".agent-backups"]);

function boundedInteger(value, fallback, min, max) {
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

async function createSafeSnapshot(sourceRoot) {
  const snapshotRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-test-snapshot-"));
  let fileCount = 0;
  let totalBytes = 0;

  async function copyDirectory(source, destination) {
    await fs.mkdir(destination, { recursive: true, mode: 0o755 });
    const entries = await fs.readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      if (OMIT_DIRS.has(entry.name) || SECRET_NAME.test(entry.name)) continue;
      const from = path.join(source, entry.name);
      const to = path.join(destination, entry.name);
      const stat = await fs.lstat(from);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        await copyDirectory(from, to);
      } else if (stat.isFile()) {
        fileCount += 1;
        totalBytes += stat.size;
        if (fileCount > MAX_FILES || totalBytes > MAX_STAGED_BYTES) {
          throw new Error("Workspace exceeds the sandbox snapshot size limits.");
        }
        await fs.copyFile(from, to);
        await fs.chmod(to, 0o444);
      }
    }
    await fs.chmod(destination, 0o555);
  }

  try {
    await copyDirectory(sourceRoot, snapshotRoot);
    await fs.chmod(snapshotRoot, 0o555);
    return snapshotRoot;
  } catch (error) {
    await fs.chmod(snapshotRoot, 0o755).catch(() => {});
    await fs.rm(snapshotRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
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

    let snapshotRoot;
    try {
      snapshotRoot = await createSafeSnapshot(realRoot);
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
        "--mount", `type=bind,src=${snapshotRoot},dst=/workspace,readonly`,
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
        return {
          passed: false,
          exitCode: Number.isInteger(error?.code) ? error.code : null,
          timedOut,
          stdout: typeof error?.stdout === "string" ? error.stdout : "",
          stderr: typeof error?.stderr === "string" ? error.stderr : "",
          sandbox: "docker",
          error: error?.code === "ENOENT"
            ? "Docker is unavailable. Tests were not run; unsandboxed fallback is disabled."
            : timedOut
              ? "Sandboxed workspace tests exceeded the 120-second time limit."
              : "Sandboxed workspace tests failed or the required image is unavailable. No unsandboxed fallback was attempted."
        };
      }
    } finally {
      if (snapshotRoot) {
        await fs.chmod(snapshotRoot, 0o755).catch(() => {});
        await fs.rm(snapshotRoot, { recursive: true, force: true }).catch(() => {});
      }
    }
  }
}
