import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { TaskRegistry } from "./task-registry.js";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_TASKS = 2000;
const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;

function validateSnapshot(snapshot) {
  if (!snapshot || snapshot.version !== 1 || !Number.isSafeInteger(snapshot.nextId) ||
      snapshot.nextId < 1 || !Array.isArray(snapshot.tasks) || snapshot.tasks.length > MAX_TASKS) {
    throw new Error("Persistent task registry has an unsupported or invalid format.");
  }
  const ids = new Set();
  for (const task of snapshot.tasks) {
    if (!task || typeof task.id !== "string" || ids.has(task.id) ||
        typeof task.task !== "string" || typeof task.status !== "string" ||
        !Array.isArray(task.history) || !Number.isFinite(Date.parse(task.createdAt)) ||
        !Number.isFinite(Date.parse(task.updatedAt))) {
      throw new Error("Persistent task registry contains an invalid task.");
    }
    ids.add(task.id);
  }
  return snapshot;
}

export class PersistentTaskRegistry extends TaskRegistry {
  constructor({ filePath }) {
    super();
    if (typeof filePath !== "string" || !filePath.trim()) throw new Error("PersistentTaskRegistry requires a filePath.");
    this.filePath = path.resolve(filePath);
    this.#load();
  }

  #load() {
    let fd;
    try {
      fd = fs.openSync(this.filePath, fs.constants.O_RDONLY | NOFOLLOW);
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error("Task registry file is unsafe or exceeds its size limit.");
      const snapshot = validateSnapshot(JSON.parse(fs.readFileSync(fd, "utf8")));
      this.tasks = new Map(snapshot.tasks.map(task => [task.id, task]));
      this.nextId = snapshot.nextId;
    } catch (error) {
      if (error.code === "ENOENT") return;
      if (error instanceof SyntaxError) throw new Error("Persistent task registry contains invalid JSON.");
      throw error;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }

  #persist() {
    if (this.tasks.size > MAX_TASKS) throw new Error("Persistent task registry task limit reached.");
    const content = JSON.stringify({
      version: 1,
      nextId: this.nextId,
      tasks: this.list()
    }, null, 2);
    if (Buffer.byteLength(content) > MAX_BYTES) throw new Error("Persistent task registry exceeds its size limit.");
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    try {
      const stat = fs.lstatSync(this.filePath);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Persistent task registry target must be a regular file.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const tempPath = path.join(directory, `.agent-tasks-${randomUUID()}.tmp`);
    let fd;
    try {
      fd = fs.openSync(tempPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | NOFOLLOW, 0o600);
      fs.writeFileSync(fd, content, "utf8");
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(tempPath, this.filePath);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      try { fs.unlinkSync(tempPath); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }

  create(task) {
    if (this.tasks.size >= MAX_TASKS) throw new Error("Persistent task registry task limit reached.");
    const record = super.create(task);
    this.#persist();
    return record;
  }

  update(taskId, updates) {
    const record = super.update(taskId, updates);
    this.#persist();
    return record;
  }

  delete(taskId) {
    const deleted = super.delete(taskId);
    if (deleted) this.#persist();
    return deleted;
  }
}
