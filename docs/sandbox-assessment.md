# Test Execution Sandbox Assessment

## Decision

Do not describe the current approval-gated Node.js test runner as a sandbox. It executes project test code under the Agent process user's operating-system permissions.

Do not enable Node.js `--permission` and label that change an OS sandbox. The Node.js Permission Model is useful defense in depth, but its documented restrictions apply primarily to selected Node.js APIs. The Node.js documentation explicitly notes that it does not guarantee filesystem isolation through other means (for example, `node:sqlite`), and that permission behavior has important constraints around workers and existing file descriptors.

Reference: https://nodejs.org/download/release/v24.21.0/docs/api/permissions.html

## Required isolation boundary

A production test executor must run project-controlled code in a separately constrained OS/container environment with:

- A dedicated unprivileged identity, never the Agent service identity.
- A workspace-only mount, with explicit read/write policy.
- No access to application secrets, API keys, home directories, or host sockets.
- Network disabled by default; any network access must be separately authorized.
- Process, memory, CPU, file-size, and wall-clock limits.
- A bounded output channel back to the Agent.
- Cleanup of the isolated environment after every run.
- Fail-closed behavior: if the required isolation backend is unavailable, do not silently fall back to unsandboxed execution for untrusted projects.

## Platform strategy

The isolation backend must be selected and verified per deployment platform. Linux container or namespace tools may be suitable for a hosted backend when their availability and security configuration are verified. Android browser clients must not be assumed to provide OS sandbox primitives; in the intended phone-friendly architecture, untrusted project execution should occur on a separately isolated backend.

No platform backend is considered implemented merely because its executable is detected. It must pass escape-resistance and resource-limit integration tests in the actual deployment environment.

## Current status

- The existing `workspace.test` tool remains approval-gated and bounded by timeout/output limits.
- It is **not** an OS sandbox.
- CI passing confirms the repository test suite, not sandbox isolation.
- OS-level isolation implementation and deployment validation remain open Phase 2 work.
