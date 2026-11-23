export class TaskPlanner {
  createPlan(task) {
    if (typeof task !== "string" || !task.trim()) {
      throw new Error("Task must be a non-empty string.");
    }

    return {
      task: task.trim(),
      status: "PLANNED",
      steps: [
        "Understand the user's request",
        "Inspect the relevant project files",
        "Prepare a safe implementation plan",
        "Request approval when required",
        "Execute approved changes",
        "Run tests and verify results"
      ]
    };
  }
}
