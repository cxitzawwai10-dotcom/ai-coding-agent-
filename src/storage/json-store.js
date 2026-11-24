import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";

const MAX_STORE_BYTES = 5 * 1024 * 1024;

export class JsonStore {
  constructor(filePath, { maxBytes = MAX_STORE_BYTES } = {}) {
    if (typeof filePath !== "string" || !filePath.trim()) throw new Error("Store path is required.");
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_STORE_BYTES) throw new Error("Invalid store size limit.");
    this.filePath = path.resolve(filePath);
    this.maxBytes = maxBytes;
    this.queue = Promise.resolve();
  }

  async read(defaultValue) {
    let handle;
    try {
      handle = await fs.open(this.filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > this.maxBytes) throw new Error("Persistent store is not a regular file or exceeds its size limit.");
      const content = await handle.readFile("utf8");
      const value = JSON.parse(content);
      return structuredClone(value);
    } catch (error) {
      if (error.code === "ENOENT") return structuredClone(defaultValue);
      if (error instanceof SyntaxError) throw new Error("Persistent store contains invalid JSON.");
      throw error;
    } finally {
      await handle?.close().catch(() => {});
    }
  }

  async write(value) {
    const operation = this.queue.then(() => this.#writeAtomic(value));
    this.queue = operation.catch(() => {});
    return operation;
  }

  async #writeAtomic(value) {
    const content = JSON.stringify(value, null, 2);
    if (Buffer.byteLength(content) > this.maxBytes) throw new Error("Persistent store exceeds its size limit.");
    const directory = path.dirname(this.filePath);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      const stat = await fs.lstat(this.filePath);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Persistent store target must be a regular file.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const tempPath = path.join(directory, `.agent-store-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await fs.open(tempPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
      await handle.writeFile(content, "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      try {
        const latest = await fs.lstat(this.filePath);
        if (latest.isSymbolicLink() || !latest.isFile()) throw new Error("Persistent store target changed during write.");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await fs.rename(tempPath, this.filePath);
      return { written: true, bytes: Buffer.byteLength(content) };
    } finally {
      await handle?.close().catch(() => {});
      await fs.unlink(tempPath).catch(() => {});
    }
  }
}
