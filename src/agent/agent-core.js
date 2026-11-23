import { TaskPlanner } from "./task-planner.js";
import { TaskLifecycle, TASK_STATES } from "./task-lifecycle.js";
import { TaskRegistry } from "./task-registry.js";

export class AgentCore {
  constructor(planner = new TaskPlanner(), registry = new TaskRegistry()) {
    this.status = "INITIALIZED";
    this.planner = planner;
    this.registry = registry;
  }

  getStatus() {
    return this.status;
  }

  getTask(taskId) {
    return this.registry.get(taskId);
  }

  getTasks(options = {}) {
    if (
      options &&
      typeof options === "object" &&
      Object.hasOwn(options, "status")
    ) {
      return this.registry.filterByStatus(options.status);
    }

    return this.registry.list();
  }

  getTaskSummary() {
    return this.registry.getSummary();
  }

  deleteTask(taskId) {
    return this.registry.delete(taskId);
  }

  async processTask(task) {
    if (typeof task !== "string" || !task.trim()) {
      throw new Error("Task must be a non-empty string.");
    }

    const normalizedTask = task.trim();
    const lifecycle = new TaskLifecycle();
    const record = this.registry.create(normalizedTask);

    try {
      const plan = this.planner.createPlan(normalizedTask);

      lifecycle.transition(TASK_STATES.PLANNED);
      this.registry.update(record.id, {
        status: TASK_STATES.PLANNED,
        result: plan
      });

      return {
        taskId: record.id,
        task: normalizedTask,
        status: "RECEIVED",
        message: "Task received and planning completed.",
        plan,
        lifecycle: {
          state: lifecycle.getState(),
          history: lifecycle.getHistory()
        }
      };
    } catch (error) {
      lifecycle.transition(TASK_STATES.FAILED);
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.registry.update(record.id, {
        status: TASK_STATES.FAILED,
        error: errorMessage
      });

      return {
        taskId: record.id,
        task: normalizedTask,
        status: "FAILED",
        message: "Task planning failed.",
        error: errorMessage,
        lifecycle: {
          state: lifecycle.getState(),
          history: lifecycle.getHistory()
        }
      };
    }
  }
}
