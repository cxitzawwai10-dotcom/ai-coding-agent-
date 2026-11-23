import { TaskPlanner } from "./task-planner.js";

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
    const plan = this.planner.createPlan(normalizedTask);

    return {
      task: normalizedTask,
      status: "RECEIVED",
      message: "Task received and planning completed.",
      plan
    };
  }
}
