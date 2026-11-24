# Workspace Tools

WorkspaceTools provides safe access to project files.

## Features
- List workspace directory entries.
- Read UTF-8 text files.
- Resolve paths inside the configured workspace.
- Reject paths outside the workspace.
- Limit file reads to 1 MB.

## API
- `new WorkspaceTools(root)`
- `list(relativePath = ".")`
- `read(relativePath)`

File modification tools will be added only with an explicit approval mechanism.
