import { TaskPlanner } from "./task-planner.js";
import { TaskLifecycle, TASK_STATES } from "./task-lifecycle.js";
import { TaskRegistry } from "./task-registry.js";
import { ToolRegistry } from "../tools/tool-registry.js";
import { registerWorkspaceTools } from "../tools/register-workspace-tools.js";
import { ApprovalManager } from "../safety/approval-manager.js";

export class AgentCore {
  constructor(
    planner = new TaskPlanner(),
    registry = new TaskRegistry(),
    executor = null,
    toolRegistry = null
  ) {
    this.status = "INITIALIZED";
    this.planner = planner;
    this.registry = registry;
    this.executor = executor;
    this.approvalManager = new ApprovalManager();
    this.toolRegistry = toolRegistry ?? new ToolRegistry(
      (id, input, options, binding) => this.approvalManager.verify(id, input, options, binding)
    );
    this.lifecycles = new Map();
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
    this.lifecycles.delete(taskId);
    return this.registry.delete(taskId);
  }

  async processTask(task) {
    if (typeof task !== "string" || !task.trim()) {
      throw new Error("Task must be a non-empty string.");
    }

    const normalizedTask = task.trim();
    const lifecycle = new TaskLifecycle();
    const record = this.registry.create(normalizedTask);

    this.lifecycles.set(record.id, lifecycle);

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

  approveTask(taskId) {
    const record = this.registry.get(taskId);
    const lifecycle = this.lifecycles.get(taskId);

    if (!record || !lifecycle) {
      throw new Error("Task not found.");
    }

    lifecycle.transition(TASK_STATES.WAITING_FOR_APPROVAL);

    const updated = this.registry.update(taskId, {
      status: TASK_STATES.WAITING_FOR_APPROVAL
    });

    return {
      taskId,
      status: updated.status,
      message: "Task approved and ready for execution.",
      lifecycle: {
        state: lifecycle.getState(),
        history: lifecycle.getHistory()
      }
    };
  }

  rejectTask(taskId, reason = "Task approval rejected.") {
    const record = this.registry.get(taskId);
    const lifecycle = this.lifecycles.get(taskId);

    if (!record || !lifecycle) {
      throw new Error("Task not found.");
    }

    if (
      typeof reason !== "string" ||
      !reason.trim()
    ) {
      throw new Error("Rejection reason must be a non-empty string.");
    }

    lifecycle.transition(TASK_STATES.FAILED);

    const updated = this.registry.update(taskId, {
      status: TASK_STATES.FAILED,
      error: reason.trim()
    });

    return {
      taskId,
      status: updated.status,
      message: "Task was rejected and will not be executed.",
      error: updated.error,
      lifecycle: {
        state: lifecycle.getState(),
        history: lifecycle.getHistory()
      }
    };
  }

  async executeTask(taskId, executor = this.executor) {
    const record = this.registry.get(taskId);
    const lifecycle = this.lifecycles.get(taskId);

    if (!record || !lifecycle) {
      throw new Error("Task not found.");
    }

    if (record.status !== TASK_STATES.WAITING_FOR_APPROVAL) {
      throw new Error("Task requires approval before execution.");
    }

    if (typeof executor !== "function") {
      throw new Error("A valid task executor is required.");
    }

    lifecycle.transition(TASK_STATES.EXECUTING);

    this.registry.update(taskId, {
      status: TASK_STATES.EXECUTING
    });

    try {
      const executionResult = await executor({
        taskId,
        task: record.task,
        plan: record.result
      });

      lifecycle.transition(TASK_STATES.COMPLETED);

      const updated = this.registry.update(taskId, {
        status: TASK_STATES.COMPLETED,
        result: {
          plan: record.result,
          executionResult
        },
        error: null
      });

      return {
        taskId,
        status: updated.status,
        message: "Task execution completed.",
        result: executionResult,
        lifecycle: {
          state: lifecycle.getState(),
          history: lifecycle.getHistory()
        }
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      lifecycle.transition(TASK_STATES.FAILED);

      this.registry.update(taskId, {
        status: TASK_STATES.FAILED,
        error: errorMessage
      });

      return {
        taskId,
        status: TASK_STATES.FAILED,
        message: "Task execution failed.",
        error: errorMessage,
        lifecycle: {
          state: lifecycle.getState(),
          history: lifecycle.getHistory()
        }
      };
    }
  }

  registerTool(definition) {
    return this.toolRegistry.register(definition);
  }

  getTools() {
    return this.toolRegistry.list();
  }

  executeTool(id, input, options = {}) {
    return this.toolRegistry.execute(id, input, options);
  }


  requestToolApproval(id, input) {
    const tool = this.toolRegistry.get(id);
    if (!tool) throw new Error("Tool not found.");
    if (!tool.requiresApproval) {
      throw new Error("This tool does not require approval.");
    }
    return this.approvalManager.request(id, input, this.toolRegistry.getApprovalBinding(id));
  }

  approveToolRequest(requestId) {
    return this.approvalManager.approve(requestId);
  }

  rejectToolRequest(requestId) {
    return this.approvalManager.reject(requestId);
  }

  attachWorkspace(root) {
    return registerWorkspaceTools(this.toolRegistry, root);
  }

}
