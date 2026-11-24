import path from "node:path";
import { pathToFileURL } from "node:url";
import { AgentCore } from "./agent/agent-core.js";

export function createAgent({
  workspaceRoot = process.cwd()
} = {}) {
  const agent = new AgentCore();
  const workspace = agent.attachWorkspace(
    path.resolve(workspaceRoot)
  );

  return {
    agent,
    workspace,
    workspaceRoot: path.resolve(workspaceRoot)
  };
}

export function startAgent() {
  const { agent, workspaceRoot } = createAgent();

  console.log("AI Coding Agent is starting...");
  console.log("Environment: Android + Ubuntu");
  console.log("Runtime: Node.js", process.version);
  console.log("Workspace:", workspaceRoot);
  console.log(
    "Tools:",
    agent.getTools().map(tool => tool.id).join(", ")
  );
  console.log("Status:", agent.getStatus());

  return agent;
}

const isMain = process.argv[1] &&
  import.meta.url === pathToFileURL(
    path.resolve(process.argv[1])
  ).href;

if (isMain) {
  startAgent();
}
