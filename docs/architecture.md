# AI Coding Agent - Architecture

## 1. Project Goal
Build an AI Coding Agent that can be operated from an Android browser without requiring Termux or a local PC setup.
It must support Burmese conversations, project management, code editing, debugging, testing, and persistent project memory.

## 2. Core Modules
- **Agent Core:** Understand tasks, plan, coordinate tools, and report verified results.
- **Project Manager:** Create, list, inspect, update, and remove project metadata. Project workspace roots remain separate; removing a project record never deletes its workspace files.
- **Project Memory:** Persist project-scoped notes, decisions, tasks, tags, and searchable context across restarts.
- **Persistent Storage:** Atomic JSON persistence for project records, project memory, and task histories; bounded files, symlink rejection, schema validation, and single-writer deployment boundaries. Interrupted executing tasks are marked failed during restart recovery.
- **Account Manager (Phase 4):** User-configurable provider accounts with official authentication and no quota evasion.
- **Backup and Recovery:** Preserve backups and require authorization for destructive recovery.
- **Workspace Inspection and Approved Coding:** Inspect files, prepare bounded proposals, require per-file approval, and rollback failed transactions.
- **Workspace Test Runner:** Fixed Node test command inside a pinned Docker sandbox; fail closed without Docker.
- **Tool Workflow Executor:** Prevalidate tool sequences, execute sequentially, stop on failure.
- **Safety Manager:** Approval gates, credential protection, and workspace boundaries.
- **Burmese Chat Interface:** Burmese and English instructions, understandable progress, and clarification for ambiguity.

## 3. Persistent Data
The agent factory exposes `projectManager` and `projectMemory`. By default they use the workspace-local `.agent-data/` directory, which is excluded from Git. A deployment may pass a separate `dataRoot` to `createAgent`.
- `projects.json`: project metadata only; no workspace contents are copied or deleted.
- `project-memory.json`: project-scoped notes, decisions, task notes, and tags.
- `tasks.json`: task descriptions, plans/results, status history, and lifecycle recovery data. Tasks interrupted in EXECUTING state are marked FAILED on restart; they are never automatically resumed.
- `project-memory.json`: project-scoped notes, decisions, task notes, and tags.
- `tasks.json`: task descriptions, plans/results, status history, and lifecycle recovery data. Tasks interrupted in EXECUTING state are marked FAILED on restart; they are never automatically resumed.
- `project-memory.json`: project-scoped memory records, tags, type, and timestamps.
- Storage is bounded to 5 MiB per JSON store and memory entries are bounded by count and content size.
- Persistent records are validated when loaded. Invalid JSON/schema fails closed rather than silently resetting user data.
- Writes use temporary files, fsync, and atomic rename. Run one active agent process per `dataRoot`; deployments with multiple server processes must use a transactional shared database before enabling concurrent multi-instance writes.

## 4. Security Principles
- Never hardcode API keys, passwords, or tokens.
- Never expose credentials in logs or project memory.
- Never delete project workspace files when deleting project metadata.
- Require approval for sensitive operations.
- Do not rotate accounts to bypass quotas or provider usage limits.
- Require approval and Docker isolation for project-controlled test execution.
- Treat the local data directory and host filesystem permissions as trusted deployment boundaries.

## 5. Development Phases
1. Project foundation and repository architecture.
2. Agent Core, workspace tools, approval security, test isolation, and rollback.
3. Persistent project memory and project management.
4. AI provider integrations and user-configurable account management.
5. Autonomous coding engine, planning, editing, debugging, and verification.
6. Android browser interface, hosted backend integration, and end-to-end release checks.

## 6. Testing
Use Node.js built-in test runner and GitHub Actions. Run integration tests before release and report only verified results.
