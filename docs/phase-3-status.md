# Phase 3 Status — Persistent Project Memory & Project Management

## Implemented
- Bounded JSON persistence layer with atomic temporary-file writes, fsync, atomic rename, symlink rejection, corrupt-data fail-closed behavior, and serialized writes within one process.
- Project Manager: create, list, get, update name/description, and remove metadata records.
- Project metadata stores stable IDs, canonical absolute workspace roots, descriptions, and timestamps.
- Duplicate workspace roots are rejected. Removing a project removes only its metadata record and never recursively deletes workspace files.
- Project Memory: project-scoped notes/decisions/tasks, tags, timestamps, bounded content, list/filter, text/tag/type search, individual removal, and project memory clear.
- Project and memory services are exposed from `createAgent()`; callers can configure `dataRoot`.
- Default runtime data directory is `.agent-data/`, excluded from Git.
- Automated tests cover persistence across service restarts, CRUD, isolation between projects, validation, limits, corrupt JSON, and concurrent writes.
- Architecture and repository guidance updated for Android-browser-first development without requiring Termux.

## Storage and deployment boundaries
- Each JSON file is limited to 5 MiB; project count is limited to 500; memory entries to 2,000; each memory item to 10,000 characters.
- Writes are serialized inside one Node.js process. This is not a multi-process transactional database. A multi-instance hosted deployment must replace this adapter with a transactional shared database before concurrent multi-instance writes are enabled.
- The data directory must be private to the agent process and backed up by the deployment. JSON persistence does not encrypt memory at rest.
- The current task registry and in-flight task lifecycle remain in-memory; durable task-history restoration is not claimed as completed in this phase.

## Verification
GitHub Actions verification is pending for the Phase 3 implementation commit. Phase 3 must not be marked complete until the CI run and all test logs are checked.
