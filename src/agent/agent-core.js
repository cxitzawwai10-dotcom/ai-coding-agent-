import { TaskPlanner } from "./task-planner.js";
import { TaskLifecycle, TASK_STATES } from "./task-lifecycle.js";
import { TaskRegistry } from "./task-registry.js";
import { ToolRegistry } from "../tools/tool-registry.js";
import { registerWorkspaceTools } from "../tools/register-workspace-tools.js";
import { registerTestTools } from "../tools/register-test-tools.js";
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




  async inspectTaskWorkspace(taskId, paths) {
    const record = this.registry.get(taskId);
    if (!record || !this.lifecycles.has(taskId)) {
      throw new Error("Task not found.");
    }
    if (record.status !== TASK_STATES.PLANNED) {
      throw new Error("Workspace inspection is only allowed for planned tasks.");
    }
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > 20) {
      throw new Error("Workspace inspection requires between 1 and 20 file paths.");
    }
    if (paths.some(filePath => typeof filePath !== "string" || !filePath.trim()) ||
        new Set(paths).size !== paths.length) {
      throw new Error("Workspace inspection paths must be unique non-empty strings.");
    }
    if (!this.toolRegistry.get("workspace.read")) {
      throw new Error("Workspace read tool is not registered.");
    }

    const files = [];
    for (const filePath of paths) {
      const content = await this.executeTool("workspace.read", { path: filePath });
      files.push({ path: filePath, content });
    }

    const plan = record.result && typeof record.result === "object"
      ? record.result
      : { task: record.task, status: TASK_STATES.PLANNED, steps: [] };
    this.registry.update(taskId, {
      result: { ...plan, workspaceInspection: files }
    });
    return { taskId, inspectedFiles: files.length, files };
  }


  prepareCodingChanges(taskId, changes) {
    const record = this.registry.get(taskId);
    if (!record || !this.lifecycles.has(taskId)) throw new Error("Task not found.");
    if (record.status !== TASK_STATES.PLANNED) {
      throw new Error("Coding changes can only be prepared for planned tasks.");
    }
    if (!Array.isArray(changes) || changes.length === 0 || changes.length > 20) {
      throw new Error("Coding change plan requires between 1 and 20 file changes.");
    }
    if (!Array.isArray(record.result?.workspaceInspection) ||
        record.result.workspaceInspection.length === 0) {
      throw new Error("Inspect workspace files before preparing coding changes.");
    }
    const seen = new Set();
    const normalized = changes.map((change, index) => {
      if (!change || typeof change !== "object" || Array.isArray(change) ||
          Object.keys(change).some(key => !["path", "content"].includes(key)) ||
          typeof change.path !== "string" || !change.path.trim() ||
          typeof change.content !== "string" ||
          Buffer.byteLength(change.content) > 1024 * 1024) {
        throw new Error(`Invalid coding change at index ${index}.`);
      }
      if (seen.has(change.path)) throw new Error("Coding change paths must be unique.");
      seen.add(change.path);
      return { path: change.path, content: change.content };
    });
    if (!this.toolRegistry.get("workspace.write")) {
      throw new Error("Workspace write tool is not registered.");
    }
    this.registry.update(taskId, {
      result: { ...record.result, proposedChanges: normalized }
    });
    return {
      taskId,
      changes: normalized.map(({ path, content }) => ({
        path,
        bytes: Buffer.byteLength(content),
        requiresApproval: true
      }))
    };
  }

  async executeCodingChanges(taskId, approvalTokens, testApprovalToken = null) {
    const record = this.registry.get(taskId);
    if (!record || !this.lifecycles.has(taskId)) throw new Error("Task not found.");
    if (record.status !== TASK_STATES.WAITING_FOR_APPROVAL) {
      throw new Error("Task requires approval before coding changes can execute.");
    }
    const changes = record.result?.proposedChanges;
    if (!Array.isArray(changes) || changes.length === 0) {
      throw new Error("No prepared coding changes are available.");
    }
    if (!Array.isArray(approvalTokens) || approvalTokens.length !== changes.length ||
        approvalTokens.some(token => typeof token !== "string" || !token)) {
      throw new Error("A separate trusted approval token is required for every file change.");
    }
    if (testApprovalToken !== null) {
      if (typeof testApprovalToken !== "string" || !testApprovalToken) {
        throw new Error("A trusted approval token is required to run workspace tests.");
      }
      if (!this.toolRegistry.get("workspace.test")) {
        throw new Error("Workspace test tool is not registered.");
      }
    }
    if (!this.workspaceTools) throw new Error("Workspace tools are not attached.");
    return this.executeTask(taskId, async () => {
      const snapshots = [];
      for (const change of changes) {
        snapshots.push(await this.workspaceTools.capture(change.path));
      }
      const results = [];
      try {
        for (let index = 0; index < changes.length; index += 1) {
          const change = changes[index];
          const result = await this.executeTool(
            "workspace.write",
            change,
            { approvalToken: approvalTokens[index] }
          );
          results.push({ index, path: change.path, result });
        }
        let tests = null;
        if (testApprovalToken !== null) {
          tests = await this.executeTool(
            "workspace.test",
            {},
            { approvalToken: testApprovalToken }
          );
          if (!tests.passed) {
            const details = [tests.error, tests.stderr, tests.stdout]
              .filter(Boolean)
              .join("\\n")
              .slice(0, 4000);
            throw new Error("Workspace tests failed after " + results.length + " file change(s). " + details);
          }
        }
        return {
          changesApplied: results.length,
          verification: tests
            ? "All workspace tests passed after the approved file changes."
            : "File writes completed; automated tests were not requested.",
          tests,
          rollback: null,
          results
        };
      } catch (error) {
        const rollbackErrors = [];
        for (let index = results.length - 1; index >= 0; index -= 1) {
          try {
            await this.workspaceTools.restore(snapshots[index], results[index].result?.identity);
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
          }
        }
        const original = error instanceof Error ? error.message : String(error);
        if (rollbackErrors.length) {
          throw new Error(original + " Rollback incomplete: " + rollbackErrors.join("; ").slice(0, 2000));
        }
        throw new Error(original + " All applied file changes were rolled back.");
      }
    });
  }

  async executeToolSequence(taskId, steps) {
    if (!Array.isArray(steps) || steps.length === 0) {
      throw new Error("Tool sequence must contain at least one step.");
    }

    const normalizedSteps = steps.map((step, index) => {
      if (!step || typeof step !== "object" || Array.isArray(step)) {
        throw new Error(`Invalid tool sequence step at index ${index}.`);
      }
      const keys = Object.keys(step);
      if (keys.some(key => !["toolId", "input", "options"].includes(key))) {
        throw new Error(`Unsupported tool sequence field at index ${index}.`);
      }
      if (typeof step.toolId !== "string" || !this.toolRegistry.get(step.toolId)) {
        throw new Error(`Unknown tool in sequence at index ${index}.`);
      }
      if (Object.hasOwn(step, "options") &&
          (!step.options || typeof step.options !== "object" || Array.isArray(step.options))) {
        throw new Error(`Invalid tool options at index ${index}.`);
      }
      return {
        toolId: step.toolId,
        input: step.input,
        options: step.options ?? {}
      };
    });

    return this.executeTask(taskId, async context => {
      const results = [];
      for (let index = 0; index < normalizedSteps.length; index += 1) {
        const step = normalizedSteps[index];
        const result = await this.executeTool(step.toolId, step.input, step.options);
        results.push({ index, toolId: step.toolId, result });
      }
      return { stepsCompleted: results.length, results };
    });
  }

  requestToolApproval(id, input) {
    const tool = this.toolRegistry.get(id);
    if (!tool) throw new Error("Tool not found.");
    if (!tool.requiresApproval) {
      throw new Error("This tool does not require approval.");
    }
    return this.approvalManager.request(id, input, this.toolRegistry.getApprovalBinding?.(id) ?? null);
  }

  approveToolRequest(requestId) {
    return this.approvalManager.approve(requestId);
  }

  rejectToolRequest(requestId) {
    return this.approvalManager.reject(requestId);
  }

  attachWorkspace(root) {
    const workspace = registerWorkspaceTools(this.toolRegistry, root);
    this.workspaceTools = workspace;
    registerTestTools(this.toolRegistry, root);
    return workspace;
  }

}
