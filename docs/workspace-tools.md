# Workspace Tools

WorkspaceTools provides bounded access to project files.

## Features
- List workspace directory entries.
- Read UTF-8 text files with a 1 MB maximum.
- Write UTF-8 text files with a 1 MB maximum.
- Reject symbolic-link targets and parent components.
- Back up existing files in a checked .agent-backups directory.
- Verify file-descriptor identity against path metadata when opening and before replacing an existing file.
- Use exclusive temporary files; publish new files with a no-overwrite hard-link operation and replace existing files with atomic rename.

## API
- new WorkspaceTools(root)
- list(relativePath = ".")
- read(relativePath)
- write(relativePath, content)

Writes require trusted approval. Portable Node.js path APIs reduce filesystem race risks but do not eliminate every TOCTOU race.
