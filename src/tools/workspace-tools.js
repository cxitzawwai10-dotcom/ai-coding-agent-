import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export class WorkspaceTools {
  constructor(root) {
    this.root = path.resolve(root);
  }

  isInside(target) {
    return target === this.root || target.startsWith(this.root + path.sep);
  }

  async resolveFile(relativePath) {
    if (typeof relativePath !== "string" || !relativePath.trim()) {
      throw new Error("Invalid file path.");
    }

    const target = path.resolve(this.root, relativePath);
    if (!this.isInside(target)) throw new Error("Path is outside workspace.");

    const real = await fs.realpath(target);
    if (!this.isInside(real)) throw new Error("Path is outside workspace.");

    return real;
  }

  async resolveWriteTarget(relativePath) {
    if (typeof relativePath !== "string" || !relativePath.trim()) {
      throw new Error("Invalid file path.");
    }

    const target = path.resolve(this.root, relativePath);
    if (!this.isInside(target)) throw new Error("Path is outside workspace.");

    const parent = await fs.realpath(path.dirname(target));
    if (!this.isInside(parent)) throw new Error("Path is outside workspace.");

    try {
      const real = await fs.realpath(target);
      if (!this.isInside(real)) throw new Error("Path is outside workspace.");
      const stat = await fs.stat(real);
      if (!stat.isFile()) throw new Error("Target is not a regular file.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    return target;
  }

  async list(relativePath = ".") {
    const target = relativePath === "."
      ? this.root
      : await this.resolveFile(relativePath);

    const items = await fs.readdir(target, { withFileTypes: true });
    return items.map(item => ({
      name: item.name,
      type: item.isDirectory() ? "directory" : "file"
    }));
  }

  async read(relativePath) {
    const target = await this.resolveFile(relativePath);
    const stat = await fs.stat(target);

    if (!stat.isFile() || stat.size > 1024 * 1024) {
      throw new Error("File is not readable or exceeds 1 MB.");
    }

    return fs.readFile(target, "utf8");
  }

  async write(relativePath, content) {
    if (typeof content !== "string" || Buffer.byteLength(content) > 1024 * 1024) {
      throw new Error("Invalid content or file exceeds 1 MB.");
    }

    const target = await this.resolveWriteTarget(relativePath);

    try {
      const stat = await fs.stat(target);
      if (stat.isFile()) {
        const backupDir = path.join(this.root, ".agent-backups");
        await fs.mkdir(backupDir, { recursive: true });
        const backupPath = path.join(backupDir, `${Date.now()}-${randomUUID()}.bak`);
        await fs.copyFile(target, backupPath);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    await fs.writeFile(target, content, { encoding: "utf8", flag: "w" });
    return { path: relativePath, written: true };
  }
}
