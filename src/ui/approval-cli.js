import { createInterface } from "node:readline/promises";

async function askUntilAnswer(rl) {
  let onClose;
  const closed = new Promise((_, reject) => {
    onClose = () => reject(new Error("Approval input ended before a response was received."));
    rl.once("close", onClose);
  });
  try {
    return await Promise.race([rl.question(""), closed]);
  } finally {
    rl.removeListener("close", onClose);
  }
}

export async function executeToolWithCliConsent(agent, id, input, { stdin = process.stdin, stdout = process.stdout } = {}) {
  const tool = agent.getTools().find(item => item.id === id);
  if (!tool) throw new Error("Tool not found.");
  if (!tool.requiresApproval) return agent.executeTool(id, input);

  const request = agent.requestToolApproval(id, input);
  const rl = createInterface({ input: stdin, output: stdout });
  let completed = false;
  try {
    stdout.write("\\n=== TOOL APPROVAL REQUIRED ===\\n");
    stdout.write(`Tool: ${request.toolId}\\n`);
    stdout.write(`Request: ${request.requestId}\\n`);
    stdout.write(`Input preview:\\n${JSON.stringify(request.input, null, 2)}\\n`);
    stdout.write("Approve this exact operation? [y/N]: ");
    const answer = (await askUntilAnswer(rl)).trim().toLowerCase();
    if (answer !== "y" && answer !== "yes") {
      agent.rejectToolRequest(request.requestId);
      completed = true;
      stdout.write("DENIED: tool was not executed.\\n");
      return { approved: false, executed: false };
    }
    const approvalToken = agent.approveToolRequest(request.requestId);
    const result = await agent.executeTool(id, request.input, { approvalToken });
    completed = true;
    stdout.write("APPROVED: tool execution completed.\\n");
    return { approved: true, executed: true, result };
  } finally {
    if (!completed) {
      try { agent.rejectToolRequest(request.requestId); } catch {}
    }
    rl.close();
  }
}
