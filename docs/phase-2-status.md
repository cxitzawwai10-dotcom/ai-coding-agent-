# Phase 2 Status

## Implemented
- Agent Core, Task Planner, Task Lifecycle and Task Registry.
- Tool registration, discovery, input validation and execution.
- One-time approval tokens with expiration, exact-input binding and tool-registration identity binding.
- Bounded approval registries with expired-record cleanup.
- Workspace listing, bounded reading and approved writing.
- Task-scoped read-only workspace inspection that attaches source-file context to the approved execution plan.
- Inspected coding change proposals and sequential file writes requiring a separate one-time approval token for every file.
- Transaction-style coding execution snapshots every target before writes and rolls back applied changes in reverse order when a later write approval or post-write test fails; rollback checks the identity of each file written by the transaction before restoring or removing it.
- Approval-gated `workspace.test` tool using a Docker-isolated Node.js test runner, a 120-second timeout, bounded output, disabled networking, read-only root/workspace mounts, dropped Linux capabilities, no-new-privileges, and CPU/memory/process limits.
- Test execution stages a bounded read-only snapshot and excludes VCS metadata, backups, symlinks, and likely secret/credential files; Docker absence or image absence fails closed with no host-execution fallback.
- Docker sandbox unit tests verify the isolation flags and fail-closed behavior; the real Docker daemon/image execution still requires deployment-level verification.
- Optional post-write test execution inside the coding task, requiring its own one-time test approval; a failing test run marks the task failed.
- Sequential registered-tool workflows with preflight validation and fail-fast execution.
- Checked backup directory, symlink rejection, file-identity checks and atomic temporary-file writes.
- New-file publication that refuses to overwrite a concurrently created target.
- Primary CLI tool execution wired through user-facing consent prompts; protected operations require explicit confirmation and default-deny on rejection or input EOF.
- Automated unit, integration and security regression tests.

## Remaining verification
- Android device end-to-end execution.
- Broader filesystem race testing under concurrent hostile modification; path-based Node.js APIs still leave a narrow parent-directory TOCTOU limitation.
- Verify the Docker sandbox against a real Docker daemon on the intended hosted backend, including adversarial escape tests and resource-limit tests.
- Android device end-to-end execution remains pending.
- Broader filesystem race testing under concurrent hostile modification; path-based Node.js APIs still leave a narrow parent-directory TOCTOU limitation.

Portable Node.js path operations reduce but cannot completely eliminate all parent-directory TOCTOU races. Automated test success does not by itself establish production security.
