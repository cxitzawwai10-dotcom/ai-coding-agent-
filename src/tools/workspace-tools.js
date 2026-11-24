import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { pipeline } from "node:stream/promises";

const MAX_BYTES = 1024 * 1024;
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

export class WorkspaceTools {
  constructor(root) { this.root = path.resolve(root); }
  isInside(target) { return target === this.root || target.startsWith(this.root + path.sep); }

  async realRoot() {
    const root = await fs.realpath(this.root);
    if (!(await fs.stat(root)).isDirectory()) throw new Error("Workspace root is not a directory.");
    return root;
  }

  async resolveParent(relativePath) {
    if (typeof relativePath !== "string" || !relativePath.trim()) throw new Error("Invalid file path.");
    const root = await this.realRoot();
    const target = path.resolve(root, relativePath);
    if (!this.isInside(target) || target === root) throw new Error("Path is outside workspace.");
    const parent = await fs.realpath(path.dirname(target));
    if (!this.isInside(parent)) throw new Error("Path is outside workspace.");
    let current = root;
    for (const part of path.relative(root, parent).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      const st = await fs.lstat(current);
      if (st.isSymbolicLink() || !st.isDirectory()) throw new Error("Workspace path contains a symlink or non-directory.");
    }
    return { root, target, parent };
  }

  async resolveFile(relativePath) {
    const { target } = await this.resolveParent(relativePath);
    const st = await fs.lstat(target);
    if (st.isSymbolicLink()) throw new Error("Symbolic links are not allowed.");
    if (!st.isFile()) throw new Error("Target is not a regular file.");
    const real = await fs.realpath(target);
    if (!this.isInside(real)) throw new Error("Path is outside workspace.");
    return real;
  }

  async list(relativePath = ".") {
    const root = await this.realRoot();
    let target = root;
    if (relativePath !== ".") {
      if (typeof relativePath !== "string" || !relativePath.trim()) throw new Error("Invalid directory path.");
      const candidate = path.resolve(root, relativePath);
      if (!this.isInside(candidate)) throw new Error("Path is outside workspace.");
      const real = await fs.realpath(candidate);
      if (!this.isInside(real)) throw new Error("Path is outside workspace.");
      let current = root;
      for (const part of path.relative(root, real).split(path.sep).filter(Boolean)) {
        current = path.join(current, part);
        const st = await fs.lstat(current);
        if (st.isSymbolicLink() || !st.isDirectory()) throw new Error("Unsafe workspace directory.");
      }
      target = real;
    }
    const items = await fs.readdir(target, { withFileTypes: true });
    return items.map(item => ({ name: item.name, type: item.isDirectory() ? "directory" : "file" }));
  }

  async read(relativePath) {
    const target = await this.resolveFile(relativePath);
    const handle = await fs.open(target, constants.O_RDONLY | NOFOLLOW);
    try {
      const st = await handle.stat();
      if (!st.isFile() || st.size > MAX_BYTES) throw new Error("File is not readable or exceeds 1 MB.");
      const chunks = [];
      let total = 0;
      const buffer = Buffer.alloc(64 * 1024);
      while (true) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
        if (!bytesRead) break;
        total += bytesRead;
        if (total > MAX_BYTES) throw new Error("File exceeds 1 MB.");
        chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
      }
      return Buffer.concat(chunks).toString("utf8");
    } finally { await handle.close(); }
  }

  async write(relativePath, content) {
    if (typeof content !== "string" || Buffer.byteLength(content) > MAX_BYTES) throw new Error("Invalid content or file exceeds 1 MB.");
    const { root, target, parent } = await this.resolveParent(relativePath);
    let source = null;
    let existed = false;
    try {
      const st = await fs.lstat(target);
      if (st.isSymbolicLink()) throw new Error("Symbolic-link write targets are not allowed.");
      if (!st.isFile()) throw new Error("Target is not a regular file.");
      source = await fs.open(target, constants.O_RDONLY | NOFOLLOW);
      if (!(await source.stat()).isFile()) throw new Error("Target is not a regular file.");
      existed = true;
    } catch (error) {
      if (error.code !== "ENOENT") { if (source) await source.close(); throw error; }
    }

    let backup = null;
    let temp = null;
    let backupPath = null;
    let tempPath = null;
    try {
      if (existed) {
        const dir = path.join(root, ".agent-backups");
        try { await fs.mkdir(dir, { mode: 0o700 }); }
        catch (error) { if (error.code !== "EEXIST") throw error; }
        const ds = await fs.lstat(dir);
        if (ds.isSymbolicLink() || !ds.isDirectory()) throw new Error("Backup directory must be a real directory, not a symlink.");
        const realDir = await fs.realpath(dir);
        if (!this.isInside(realDir)) throw new Error("Backup directory is outside workspace.");
        backupPath = path.join(realDir, `${Date.now()}-${randomUUID()}.bak`);
        backup = await fs.open(backupPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | NOFOLLOW, 0o600);
        await pipeline(source.createReadStream({ autoClose: false }), backup.createWriteStream({ autoClose: false }));
        await backup.sync();
        await backup.close();
        backup = null;
      }

      if (await fs.realpath(parent) !== parent || !this.isInside(parent)) throw new Error("Workspace parent changed during write.");
      tempPath = path.join(parent, `.agent-${randomUUID()}.tmp`);
      temp = await fs.open(tempPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | NOFOLLOW, 0o600);
      await temp.writeFile(content, "utf8");
      await temp.sync();
      await temp.close();
      temp = null;

      if (await fs.realpath(parent) !== parent || !this.isInside(parent)) throw new Error("Workspace parent changed before commit.");
      if (existed) {
        const latest = await fs.lstat(target);
        if (latest.isSymbolicLink() || !latest.isFile()) throw new Error("Write target changed during operation.");
      } else {
        try { await fs.lstat(target); throw new Error("Write target appeared during operation."); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
      }
      await fs.rename(tempPath, target);
      tempPath = null;
      return { path: relativePath, written: true };
    } finally {
      if (temp) await temp.close().catch(() => {});
      if (backup) await backup.close().catch(() => {});
      if (source) await source.close().catch(() => {});
      if (tempPath) await fs.unlink(tempPath).catch(() => {});
    }
  }
}
