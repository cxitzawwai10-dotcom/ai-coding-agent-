# Tool Registry

Manages tool registration, discovery, validation and execution.

## Features
- Register unique tool IDs.
- Retrieve and list tool metadata.
- Unregister tools.
- Execute asynchronous tools.
- Validate tool input.
- Require trusted approval for protected tools.

Protected tools require an injected approvalVerifier callback. A caller-provided boolean such as approved: true is not sufficient.

## Workspace integration
AgentCore exposes registerTool(), getTools(), executeTool() and attachWorkspace(root).

Workspace tools:
- workspace.list
- workspace.read
- workspace.write (requires a one-time trusted approval token)
