import { TaskPlanner } from "./task-planner.js";
import { TaskLifecycle, TASK_STATES } from "./task-lifecycle.js";

export class AgentCore {
  constructor(planner = new TaskPlanner()) {
    this.status = "INITIALIZED";
    this.planner = planner;
  }

  getStatus() {
    return this.status;
  }

  async processTask(task) {
    if (typeof task !== "string" || !task.trim()) {
      throw new Error("Task must be a non-empty string.");
    }

    const normalizedTask = task.trim();
    const lifecycle = new TaskLifecycle();

    try {
      const plan = this.planner.createPlan(normalizedTask);

      lifecycle.transition(TASK_STATES.PLANNED);

      return {
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

      return {
        task: normalizedTask,
        status: "FAILED",
        message: "Task planning failed.",
        error: error instanceof Error ? error.message : String(error),
        lifecycle: {
          state: lifecycle.getState(),
          history: lifecycle.getHistory()
        }
      };
    }
  }
}
