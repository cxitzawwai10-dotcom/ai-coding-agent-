import { WorkspaceTools } from "./workspace-tools.js";

export function registerWorkspaceTools(registry, root) {
  const workspace = new WorkspaceTools(root);

  registry.register({
    id: "workspace.list",
    description: "List files and directories in the workspace.",
    validateInput: input =>
      input === undefined ||
      (input !== null && typeof input === "object" &&
       !Array.isArray(input) &&
       (input.path === undefined || typeof input.path === "string")),
    execute: input => workspace.list(input?.path ?? ".")
  });

  registry.register({
    id: "workspace.read",
    description: "Read a UTF-8 text file from the workspace.",
    validateInput: input =>
      input !== null && typeof input === "object" &&
      !Array.isArray(input) && typeof input.path === "string" &&
      input.path.trim().length > 0,
    execute: input => workspace.read(input.path)
  });

  registry.register({
    id: "workspace.write",
    description: "Write or update a workspace file after trusted approval.",
    requiresApproval: true,
    validateInput: input =>
      input !== null && typeof input === "object" &&
      !Array.isArray(input) &&
      typeof input.path === "string" && input.path.trim().length > 0 &&
      typeof input.content === "string" &&
      Buffer.byteLength(input.content) <= 1024 * 1024,
    execute: input => workspace.write(input.path, input.content)
  });

  return workspace;
}
