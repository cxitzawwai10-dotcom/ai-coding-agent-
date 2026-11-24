# Tool Registry

Manages tool registration, discovery, validation and execution.

## Features
- Register unique tool IDs.
- Retrieve and list tool metadata.
- Unregister tools.
- Execute asynchronous tools.
- Validate tool input.
- Require trusted approval for protected tools.
- Bind each approval to the exact tool registration, preventing a replacement tool with the same ID from reusing an earlier approval.

Protected tools require an injected approvalVerifier callback. A caller-provided boolean such as approved: true is not sufficient.

## Workspace integration
AgentCore exposes registerTool(), getTools(), executeTool() and attachWorkspace(root).

Workspace tools:
- workspace.list
- workspace.read
- workspace.write (requires a one-time trusted approval token)


## CLI consent flow

The primary application entrypoint routes tool commands through the consent UI:

```sh
node src/index.js --tool workspace.write --input '{"path":"notes.txt","content":"example"}'
```

For protected tools, the CLI displays the tool ID, description, and exact JSON input. Only an explicit `y` or `yes` issues the one-time approval token. Any other answer denies execution; if standard input closes before an answer, the pending request is rejected. Unprotected tools execute without an approval prompt. Programmatic callers must still supply a valid one-time approval token when calling protected tools directly.
