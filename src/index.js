import path from "node:path";
import { pathToFileURL } from "node:url";
import { AgentCore } from "./agent/agent-core.js";
import { PersistentTaskRegistry } from "./agent/persistent-task-registry.js";
import { ProjectManager } from "./projects/project-manager.js";
import { ProjectMemory } from "./memory/project-memory.js";
import { executeToolWithCliConsent } from "./ui/approval-cli.js";
import { AccountVault, ProviderClient } from "./providers/index.js";
import { AutonomousCodingEngine } from "./agent/autonomous-coding-engine.js";
import { createBrowserServer } from "./ui/browser-server.js";

export function createAgent({
  workspaceRoot = process.cwd(),
  dataRoot = path.join(workspaceRoot, ".agent-data")
} = {}) {
  const resolvedDataRoot = path.resolve(dataRoot);
  const taskRegistry = new PersistentTaskRegistry({ filePath: path.join(resolvedDataRoot, "tasks.json") });
  const agent = new AgentCore(undefined, taskRegistry);
  const workspace = agent.attachWorkspace(
    path.resolve(workspaceRoot)
  );
  const projectManager = new ProjectManager({ storePath: path.join(resolvedDataRoot, "projects.json") });
  const projectMemory = new ProjectMemory({ storePath: path.join(resolvedDataRoot, "project-memory.json") });
  const accountVault = process.env.AI_AGENT_VAULT_KEY
    ? new AccountVault({ filePath: path.join(resolvedDataRoot, "accounts.json") })
    : null;
  const providerClient = accountVault ? new ProviderClient({ accountVault }) : null;
  const codingEngine = providerClient ? new AutonomousCodingEngine({ agent, providerClient }) : null;

  return {
    agent,
    workspace,
    workspaceRoot: path.resolve(workspaceRoot),
    dataRoot: resolvedDataRoot,
    projectManager,
    projectMemory,
    taskRegistry
  };
}

export function createBrowserApp(options = {}) {\n  const services = createAgent(options);\n  const browser = createBrowserServer({\n    agent: services.agent, projectManager: services.projectManager,\n    accountVault: services.accountVault, codingEngine: services.codingEngine,\n    ...options.browser\n  });\n  return { ...services, browser };\n}\n\nexport async function runToolCommand(agent, id, inputJson, io = {}) {
  if (typeof inputJson !== "string") {
    throw new Error("Tool input must be supplied as JSON text.");
  }

  let input;
  try {
    input = JSON.parse(inputJson);
  } catch {
    throw new Error("Invalid JSON supplied for tool input.");
  }

  const result = await executeToolWithCliConsent(agent, id, input, io);
  const output = io.stdout ?? process.stdout;
  output.write(`RESULT: ${JSON.stringify(result)}\n`);
  return result;
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
  const agent = startAgent();
  const args = process.argv.slice(2);
  if (args.length > 0) {
    if (args.length !== 4 || args[0] !== "--tool" || args[2] !== "--input") {
      console.error("Usage: node src/index.js --tool <tool-id> --input '<json>'");
      process.exitCode = 2;
    } else {
      try {
        await runToolCommand(agent, args[1], args[3]);
      } catch (error) {
        console.error("TOOL ERROR:", error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    }
  }
}
