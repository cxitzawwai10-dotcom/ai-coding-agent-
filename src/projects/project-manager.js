import path from "node:path";
import { randomUUID } from "node:crypto";
import { JsonStore } from "../storage/json-store.js";

const DEFAULT_STATE = { version: 1, projects: [] };
const MAX_PROJECTS = 500;
const MAX_TEXT = 200;

function requiredText(value, label, max = MAX_TEXT) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new Error(`${label} must be a non-empty string of at most ${max} characters.`);
  }
  return value.trim();
}

function validateState(state) {
  if (!state || state.version !== 1 || !Array.isArray(state.projects) || state.projects.length > MAX_PROJECTS) {
    throw new Error("Project store has an unsupported or invalid format.");
  }
  const ids = new Set();
  for (const project of state.projects) {
    if (!project || typeof project.id !== "string" || ids.has(project.id) ||
        typeof project.name !== "string" || typeof project.root !== "string" ||
        !Number.isFinite(Date.parse(project.createdAt)) ||
        !Number.isFinite(Date.parse(project.updatedAt))) {
      throw new Error("Project store contains an invalid project record.");
    }
    ids.add(project.id);
  }
  return state;
}

export class ProjectManager {
  constructor({ storePath }) {
    if (!storePath) throw new Error("ProjectManager requires a persistent storePath.");
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

  async list() {
    await this.queue;
    return validateState(await this.store.read(DEFAULT_STATE)).projects;
  }

  async get(projectId) {
    if (typeof projectId !== "string" || !projectId) throw new Error("Project ID is required.");
    return (await this.list()).find(project => project.id === projectId) ?? null;
  }

  async create({ name, root, description = "" }) {
    const projectName = requiredText(name, "Project name");
    const projectRoot = path.resolve(requiredText(root, "Project root", 1000));
    if (typeof description !== "string" || description.length > 2000) throw new Error("Project description must be at most 2000 characters.");
    return this.#mutate(state => {
      if (state.projects.length >= MAX_PROJECTS) throw new Error("Project limit reached.");
      if (state.projects.some(project => project.root === projectRoot)) throw new Error("A project already uses this workspace root.");
      const now = new Date().toISOString();
      const project = {
        id: `project-${randomUUID()}`,
        name: projectName,
        root: projectRoot,
        description: description.trim(),
        createdAt: now,
        updatedAt: now
      };
      state.projects.push(project);
      return project;
    });
  }

  async update(projectId, updates) {
    if (!updates || typeof updates !== "object" || Array.isArray(updates) ||
        Object.keys(updates).length === 0 ||
        Object.keys(updates).some(key => !["name", "description"].includes(key))) {
      throw new Error("Only project name and description can be updated.");
    }
    return this.#mutate(state => {
      const project = state.projects.find(item => item.id === projectId);
      if (!project) throw new Error("Project not found.");
      if (Object.hasOwn(updates, "name")) project.name = requiredText(updates.name, "Project name");
      if (Object.hasOwn(updates, "description")) {
        if (typeof updates.description !== "string" || updates.description.length > 2000) throw new Error("Project description must be at most 2000 characters.");
        project.description = updates.description.trim();
      }
      project.updatedAt = new Date().toISOString();
      return project;
    });
  }

  async remove(projectId) {
    return this.#mutate(state => {
      const index = state.projects.findIndex(item => item.id === projectId);
      if (index < 0) return false;
      state.projects.splice(index, 1);
      return true;
    });
  }
}
