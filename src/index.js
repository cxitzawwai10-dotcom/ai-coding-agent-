import path from "node:path";
import { pathToFileURL } from "node:url";
import { AgentCore } from "./agent/agent-core.js";
import { PersistentTaskRegistry } from "./agent/persistent-task-registry.js";
import { ProjectManager } from "./projects/project-manager.js";
import { ProjectMemory } from "./memory/project-memory.js";
import { executeToolWithCliConsent } from "./ui/approval-cli.js";
import { ChatGPTAccountStore, ChatGPTOAuth, ChatGPTClient } from "./providers/index.js";
import { AutonomousCodingEngine } from "./agent/autonomous-coding-engine.js";
import { createBrowserServer } from "./ui/browser-server.js";

export function createAgent({ workspaceRoot = process.cwd(), dataRoot = path.join(workspaceRoot, ".agent-data") } = {}) {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const resolvedDataRoot = path.resolve(dataRoot);
  const taskRegistry = new PersistentTaskRegistry({ filePath: path.join(resolvedDataRoot, "tasks.json") });
  const agent = new AgentCore(undefined, taskRegistry);
  const workspace = agent.attachWorkspace(resolvedWorkspaceRoot);
  const projectManager = new ProjectManager({ storePath: path.join(resolvedDataRoot, "projects.json") });
  const projectMemory = new ProjectMemory({ storePath: path.join(resolvedDataRoot, "project-memory.json") });
  const accountStore = process.env.AI_AGENT_VAULT_KEY
    ? new ChatGPTAccountStore({ filePath: path.join(resolvedDataRoot, "chatgpt-accounts.json") })
    : null;
  const chatgptOAuth = accountStore
    ? new ChatGPTOAuth({ accountStore, hostIdPath: path.join(resolvedDataRoot, "chatgpt-host.json") })
    : null;
  const providerClient = accountStore ? new ChatGPTClient({ accountStore }) : null;
  const codingEngine = providerClient ? new AutonomousCodingEngine({ agent, providerClient }) : null;
  return { agent, workspace, workspaceRoot: resolvedWorkspaceRoot, dataRoot: resolvedDataRoot, projectManager, projectMemory, taskRegistry, accountStore, chatgptOAuth, providerClient, codingEngine };
}

export function createBrowserApp(options = {}) {
  const services = createAgent(options);
  const browser = createBrowserServer({
    agent: services.agent,
    projectManager: services.projectManager,
    accountStore: services.accountStore,
    chatgptOAuth: services.chatgptOAuth,
    providerClient: services.providerClient,
    codingEngine: services.codingEngine,
    ...(options.browser ?? {})
  });
  return { ...services, browser };
}

export async function runToolCommand(agent, id, inputJson, io = {}) {
  if (typeof inputJson !== "string") throw new Error("Tool input must be supplied as JSON text.");
  let input;
  try { input = JSON.parse(inputJson); } catch { throw new Error("Invalid JSON supplied for tool input."); }
  const result = await executeToolWithCliConsent(agent, id, input, io);
  const output = io.stdout ?? process.stdout;
  output.write(`RESULT: ${JSON.stringify(result)}\n`);
  return result;
}

export function startAgent() {
  const { agent, workspaceRoot } = createAgent();
  console.log("AI Coding Agent is starting...");
  console.log("Environment: Android browser + hosted Node.js");
  console.log("Runtime: Node.js", process.version);
  console.log("Workspace:", workspaceRoot);
  console.log("Tools:", agent.getTools().map(tool => tool.id).join(", "));
  console.log("Status:", agent.getStatus());
  return agent;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--server") {
    try {
      const app = createBrowserApp({ browser: { host: process.env.AI_AGENT_HOST || "127.0.0.1", port: Number(process.env.PORT || 8787) } });
      const address = await app.browser.listen();
      console.log("Browser server listening:", address);
      if (process.env.AI_AGENT_HOST && process.env.AI_AGENT_HOST !== "127.0.0.1") console.warn("ChatGPT plan OAuth sign-in is disabled for remote hosts; the official open-source flow requires a local 127.0.0.1 callback.");
    } catch (error) {
      console.error("SERVER ERROR:", error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  } else {
    const agent = startAgent();
    if (args.length > 0) {
      if (args.length !== 4 || args[0] !== "--tool" || args[2] !== "--input") {
        console.error("Usage: node src/index.js [--server | --tool <tool-id> --input '<json>']");
        process.exitCode = 2;
      } else {
        try { await runToolCommand(agent, args[1], args[3]); }
        catch (error) {
          console.error("TOOL ERROR:", error instanceof Error ? error.message : String(error));
          process.exitCode = 1;
        }
      }
    }
  }
}
