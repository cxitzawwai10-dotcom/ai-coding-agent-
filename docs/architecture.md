# AI Coding Agent - Architecture

## 1. Project Goal
Build an AI Coding Agent that can be operated from Android without requiring Termux or a local PC setup.
It must support Burmese conversations, project management, code
editing, debugging, testing, and persistent project memory.

## 2. Core Modules

### Agent Core
- Understand user instructions.
- Plan and execute coding tasks.
- Coordinate tools and project modules.
- Report actual results and errors.

### Account Manager
- Support a user-configurable number of accounts.
- Add, remove, inspect, and select accounts.
- Keep account data isolated.
- Use only officially supported authentication.
- Never rotate accounts to evade quotas or usage limits.

### Project Manager
- Create and manage multiple projects.
- Maintain separate project workspaces.
- Inspect files before making changes.

### Project Memory
- Persist project decisions and progress locally.
- Store task history and handover notes.
- Resume work after application restarts.

### Backup and Recovery
- Back up important files before significant changes.
- Support recovery from verified backups.
- Never overwrite backups without authorization.

### Workspace Inspection
- Inspect up to 20 unique workspace files for a planned task using the bounded read-only tool.
- Attach inspected file contents to the task plan as execution context.
- Reject inspection after task approval or outside the planned state.

### Approved Coding Change Workflow
- Require workspace inspection before preparing a bounded change proposal.
- Bind each proposed file path and content to its own one-time trusted approval token.
- Apply changes through the protected workspace write tool only after task approval.
- Capture every target's prior state before applying changes; on a later write or test failure, restore applied files in reverse order and remove newly created files only when their post-write file identity still matches.
- Report incomplete rollback explicitly instead of claiming the workspace was restored.
- Optionally run the workspace test suite after writes, with a separate one-time test approval.
- Mark the task failed when the approved test run fails; report writes and test results distinctly.

### Workspace Test Runner
- Register `workspace.test` when a workspace is attached.
- Run only the fixed Node.js built-in test command (`node --test`) from the workspace root; callers cannot supply commands or arguments.
- Require a one-time trusted approval for every test run.
- Limit execution to 120 seconds and capture at most 1 MB of combined output.
- Pass a reduced environment to the test process.
- Treat test files as executable project code: approval is required, but this is not an OS-level sandbox and tests still run with the agent process user's filesystem permissions.

### Tool Workflow Executor
- Execute a prevalidated sequence of registered tools in order.
- Require task-level approval before a task workflow starts.
- Preserve each protected tool's independent approval checks.
- Stop immediately when a tool fails and record the task failure.
- Return ordered per-step results for verification.

### Safety Manager
- Require approval for sensitive operations.
- Protect API keys and credentials.
- Prevent unauthorized file deletion or modification.
- Keep operations within approved workspaces.

### Burmese Chat Interface
- Accept Burmese and English instructions.
- Display understandable progress and error messages.
- Ask for clarification when instructions are ambiguous.

## 3. Project Structure

- src/agent: Agent Core
- src/accounts: Account Manager
- src/projects: Project Manager
- src/memory: Persistent Memory
- src/backup: Backup and Recovery
- src/safety: Safety and Permissions
- src/ui: Chat Interface
- tests: Automated Tests
- data: Local application data
- docs: Documentation

## 4. Security Principles
- Never hardcode API keys, passwords, or tokens.
- Never expose credentials in logs.
- Follow provider authentication and service terms.
- Do not use account switching to bypass quotas.
- Ask for approval before destructive operations.
- Do not treat approval-gated project tests as sandboxed code.

## 5. Development Phases
1. Project foundation and architecture.
2. Agent Core.
3. Project Manager and workspace operations.
4. Safety and backup systems.
5. Persistent project memory.
6. Account Manager and provider integration.
7. Burmese Chat Interface.
8. Integration tests and Android usability checks.

## 6. Testing
- Use Node.js built-in test runner.
- Test each module independently.
- Run integration tests before release.
- Report only verified results.
