function cloneTask(task) {
  return structuredClone(task);
}

export class TaskRegistry {
  constructor() {
    this.tasks = new Map();
    this.nextId = 1;
  }

  create(task) {
    if (typeof task !== "string" || !task.trim()) {
      throw new Error("Task must be a non-empty string.");
    }

    const now = new Date().toISOString();

    const record = {
      id: `task-${this.nextId++}`,
      task: task.trim(),
      status: "RECEIVED",
      createdAt: now,
      updatedAt: now,
      result: null,
      error: null,
      history: [{ status: "RECEIVED", timestamp: now }]
    };

    this.tasks.set(record.id, record);
    return cloneTask(record);
  }

  get(taskId) {
    const record = this.tasks.get(taskId);
    return record ? cloneTask(record) : null;
  }

  list() {
    return Array.from(this.tasks.values(), cloneTask);
  }

  filterByStatus(status) {
    if (typeof status !== "string" || !status.trim()) {
      throw new Error("Status must be a non-empty string.");
    }

    return this.list().filter(task => task.status === status);
  }

  getSummary() {
    const byStatus = {};

    for (const record of this.tasks.values()) {
      byStatus[record.status] = (byStatus[record.status] || 0) + 1;
    }

    return {
      total: this.tasks.size,
      byStatus
    };
  }

  update(taskId, updates) {
    const record = this.tasks.get(taskId);

    if (!record) {
      throw new Error("Task not found.");
    }

    if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
      throw new Error("Task updates must be an object.");
    }

    const allowedFields = ["status", "result", "error"];

    for (const field of Object.keys(updates)) {
      if (!allowedFields.includes(field)) {
        throw new Error(`Unsupported task field: ${field}`);
      }
    }

    if (
      Object.hasOwn(updates, "status") &&
      (typeof updates.status !== "string" || !updates.status.trim())
    ) {
      throw new Error("Status must be a non-empty string.");
    }

    const previousStatus = record.status;

    Object.assign(record, updates, {
      updatedAt: new Date().toISOString()
    });

    record.history.push({
      status: record.status,
      timestamp: record.updatedAt,
      previousStatus,
      resultUpdated: Object.hasOwn(updates, "result"),
      errorUpdated: Object.hasOwn(updates, "error")
    });

    return cloneTask(record);
  }

  delete(taskId) {
    return this.tasks.delete(taskId);
  }
}
