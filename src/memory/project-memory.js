import { randomUUID } from "node:crypto";
import { JsonStore } from "../storage/json-store.js";

const DEFAULT_STATE = { version: 1, projects: {} };
const MAX_ENTRIES = 2000;
const MAX_CONTENT = 10000;
const MAX_TAGS = 20;

function validateState(state) {
  if (!state || state.version !== 1 || !state.projects || typeof state.projects !== "object" ||
      Array.isArray(state.projects)) throw new Error("Project memory store has an unsupported or invalid format.");
  let count = 0;
  for (const [projectId, entries] of Object.entries(state.projects)) {
    if (!projectId || !Array.isArray(entries)) throw new Error("Project memory contains invalid entries.");
    count += entries.length;
    for (const entry of entries) {
      if (!entry || typeof entry.id !== "string" || typeof entry.content !== "string" ||
          typeof entry.type !== "string" || !Number.isFinite(Date.parse(entry.createdAt)) ||
          !Array.isArray(entry.tags)) throw new Error("Project memory contains an invalid record.");
    }
  }
  if (count > MAX_ENTRIES) throw new Error("Project memory entry limit exceeded.");
  return state;
}

export class ProjectMemory {
  constructor({ storePath }) {
    if (!storePath) throw new Error("ProjectMemory requires a persistent storePath.");
    this.store = new JsonStore(storePath);
    this.queue = Promise.resolve();
  }

  async #mutate(mutator) {
    const operation = this.queue.then(async () => {
      const state = validateState(await this.store.read(DEFAULT_STATE));
      const result = await mutator(state);
      await this.store.write(state);
      return structuredClone(result);
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  async add(projectId, { content, type = "note", tags = [] }) {
    if (typeof projectId !== "string" || !projectId.trim()) throw new Error("Project ID is required.");
    if (typeof content !== "string" || !content.trim() || content.length > MAX_CONTENT) throw new Error("Memory content must contain 1 to 10000 characters.");
    if (typeof type !== "string" || !/^[a-z][a-z0-9_-]{0,39}$/.test(type)) throw new Error("Invalid memory type.");
    if (!Array.isArray(tags) || tags.length > MAX_TAGS ||
        tags.some(tag => typeof tag !== "string" || !tag.trim() || tag.length > 40)) {
      throw new Error("Memory tags must be at most 20 non-empty strings of at most 40 characters.");
    }
    return this.#mutate(state => {
      const count = Object.values(state.projects).reduce((sum, entries) => sum + entries.length, 0);
      if (count >= MAX_ENTRIES) throw new Error("Project memory entry limit reached.");
      const entry = {
        id: `memory-${randomUUID()}`,
        projectId,
        type,
        content: content.trim(),
        tags: [...new Set(tags.map(tag => tag.trim().toLowerCase()))],
        createdAt: new Date().toISOString()
      };
      state.projects[projectId] ??= [];
      state.projects[projectId].push(entry);
      return entry;
    });
  }

  async list(projectId, { type, limit = 100 } = {}) {
    if (typeof projectId !== "string" || !projectId.trim()) throw new Error("Project ID is required.");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error("Memory limit must be between 1 and 500.");
    await this.queue;
    const state = validateState(await this.store.read(DEFAULT_STATE));
    let entries = state.projects[projectId] ?? [];
    if (type !== undefined) entries = entries.filter(entry => entry.type === type);
    return entries.slice(-limit).reverse();
  }

  async search(projectId, query, { limit = 50 } = {}) {
    if (typeof query !== "string" || !query.trim()) throw new Error("Memory search query is required.");
    const needle = query.trim().toLocaleLowerCase();
    const entries = await this.list(projectId, { limit: 500 });
    return entries.filter(entry =>
      entry.content.toLocaleLowerCase().includes(needle) ||
      entry.tags.some(tag => tag.includes(needle)) ||
      entry.type.includes(needle)
    ).slice(0, limit);
  }

  async remove(projectId, memoryId) {
    return this.#mutate(state => {
      const entries = state.projects[projectId] ?? [];
      const index = entries.findIndex(entry => entry.id === memoryId);
      if (index < 0) return false;
      entries.splice(index, 1);
      return true;
    });
  }

  async clear(projectId) {
    return this.#mutate(state => {
      const count = (state.projects[projectId] ?? []).length;
      delete state.projects[projectId];
      return count;
    });
  }
}
