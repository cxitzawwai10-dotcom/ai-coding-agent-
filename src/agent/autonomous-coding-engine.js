function parsePaths(text) {
  if (typeof text !== "string" || text.length > 100000) throw new Error("Provider returned an invalid inspection plan.");
  let value; try { value = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); } catch { throw new Error("AI inspection plan must be valid JSON."); }
  if (!value || typeof value !== "object" || Object.keys(value).some(key => key !== "paths") || !Array.isArray(value.paths) || value.paths.length < 1 || value.paths.length > 20 || value.paths.some(item => typeof item !== "string" || !item.trim()) || new Set(value.paths).size !== value.paths.length) throw new Error("AI inspection plan must contain 1-20 unique relative paths.");
  return value.paths;
}
function parseProposal(text, inspectedPaths) {
  if (typeof text !== "string" || text.length > 2 * 1024 * 1024) throw new Error("Provider returned an invalid proposal.");
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let value; try { value = JSON.parse(cleaned); } catch { throw new Error("AI proposal must be valid JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => key !== "files") || !Array.isArray(value.files) || value.files.length < 1 || value.files.length > 20) throw new Error("AI proposal must contain 1-20 file changes.");
  const seen = new Set();
  for (const file of value.files) {
    if (!file || typeof file !== "object" || Array.isArray(file) || Object.keys(file).some(key => !["path", "content"].includes(key)) || typeof file.path !== "string" || !file.path.trim() || typeof file.content !== "string" || Buffer.byteLength(file.content) > 1024 * 1024 || seen.has(file.path) || !inspectedPaths.includes(file.path)) throw new Error("AI proposal contains an invalid, uninspected, or duplicate file change.");
    seen.add(file.path);
  }
  return value.files;
}
export class AutonomousCodingEngine {
  constructor({ agent, providerClient }) {
    if (!agent || !providerClient) throw new Error("AutonomousCodingEngine requires an agent and provider client.");
    this.agent = agent; this.providerClient = providerClient;
  }
  async createProposal({ task, model, systemInstruction = "" }) {
    const planned = await this.agent.processTask(task);
    if (planned.status !== "RECEIVED") throw new Error("Task planning failed.");
    const plan = await this.providerClient.generate({
      model, systemInstruction: "Act as a software change planner. Return only JSON {\"paths\":[\"relative/path\"]}. Select 1-20 relevant workspace file paths. Do not generate code yet. No absolute paths or traversal.",
      prompt: task
    });
    const paths = parsePaths(plan.text);
    const inspection = await this.agent.inspectTaskWorkspace(planned.taskId, paths, { allowMissing: true });
    const response = await this.providerClient.generate({
      model,
      systemInstruction: [
        'Return only JSON: {"files":[{"path":"relative/path","content":"complete file content"}]}.',
        "Only modify paths from the supplied inspection. Preserve existing behavior. No markdown, explanations, shell commands, secrets, or paths outside the workspace.",
        systemInstruction
      ].filter(Boolean).join("\n"),
      prompt: JSON.stringify({ task, inspectedFiles: inspection.files })
    });
    const files = parseProposal(response.text, paths);
    const proposal = this.agent.prepareCodingChanges(planned.taskId, files);
    const approval = this.agent.approveTask(planned.taskId);
    return { taskId: planned.taskId, status: approval.status, approvalRequired: true, changes: proposal.changes, note: "Review every proposed file change and approve it before execution." };
  }
  async executeApproved({ taskId, approvalTokens, testApprovalToken = null }) {
    return this.agent.executeCodingChanges(taskId, approvalTokens, testApprovalToken);
  }
}
