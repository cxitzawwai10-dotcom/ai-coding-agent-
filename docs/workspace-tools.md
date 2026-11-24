# Workspace Tools

WorkspaceTools provides bounded access to project files.

## Features
- List workspace directory entries.
- Read UTF-8 text files with a 1 MB maximum.
- Write UTF-8 text files with a 1 MB maximum.
- Reject symbolic-link targets and parent components.
- Back up existing files in a checked .agent-backups directory.
- Use exclusive temporary files and atomic rename for writes.

## API
- new WorkspaceTools(root)
- list(relativePath = ".")
- read(relativePath)
- write(relativePath, content)

Writes require trusted approval. Portable Node.js path APIs reduce filesystem race risks but do not eliminate every TOCTOU race.
