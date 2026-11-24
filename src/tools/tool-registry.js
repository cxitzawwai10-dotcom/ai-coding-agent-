export class ToolRegistry {
  constructor(approvalVerifier = null) {
    this.tools = new Map();
    this.approvalVerifier = approvalVerifier;
  }

  register(definition) {
    if (!definition || typeof definition !== "object" || Array.isArray(definition)) throw new Error("Invalid tool definition.");
    const { id, description, execute, requiresApproval = false, validateInput } = definition;
    if (typeof id !== "string" || !/^[a-z][a-z0-9._-]{0,63}$/.test(id)) throw new Error("Invalid tool ID.");
    if (this.tools.has(id)) throw new Error("Tool already registered.");
    if (typeof description !== "string" || !description.trim()) throw new Error("Tool description is required.");
    if (typeof execute !== "function") throw new Error("Tool execute function is required.");
    if (typeof requiresApproval !== "boolean") throw new Error("Invalid approval setting.");
    if (validateInput !== undefined && typeof validateInput !== "function") throw new Error("Invalid input validator.");
    this.tools.set(id, Object.freeze({ id, description: description.trim(), execute, requiresApproval, validateInput }));
    return this.get(id);
  }

  get(id) {
    const tool = this.tools.get(id);
    return tool ? { id: tool.id, description: tool.description, requiresApproval: tool.requiresApproval } : null;
  }

  list() {
    return [...this.tools.keys()].map(id => this.get(id));
  }

  unregister(id) {
    return this.tools.delete(id);
  }

  async execute(id, input, options = {}) {
    const tool = this.tools.get(id);
    if (!tool) throw new Error("Tool not found.");
    if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("Invalid execution options.");
    if (tool.requiresApproval && (!this.approvalVerifier || await this.approvalVerifier(id, input, options) !== true)) {
      throw new Error("Trusted approval is required.");
    }
    if (tool.validateInput && await tool.validateInput(input) !== true) throw new Error("Tool input validation failed.");
    return tool.execute(input, { toolId: id });
  }
}
