# Repository Guidelines

## Project Goal
Build an AI Coding Agent that can be operated from an Android browser without requiring Termux or a local PC setup. Support Burmese conversations, project management, code editing, debugging, testing, and persistent project memory.

## Project Structure
Keep source code organized into clear modules: agent, projects, memory, storage, accounts, backup, safety, and UI. Keep tests separate from application source code.

## Development Rules
- Inspect existing files before modifying them.
- Never overwrite or delete user data without explicit approval.
- Make backups before significant changes.
- Keep modules small and maintainable.
- Explain important changes in clear Burmese.
- Do not hardcode API keys, passwords, or access tokens.
- Keep runtime state under an ignored data directory or an explicitly configured external data root.

## Security
- Require approval for operations outside the project workspace.
- Never expose authentication credentials or store them in project memory.
- Do not implement account switching to evade provider quotas or usage limits.
- Follow provider authentication rules and service terms.
- Deleting a project record must never delete its workspace contents implicitly.

## Testing
Run syntax checks and relevant tests after meaningful changes. Report actual results and do not claim tests passed without verification.

## Documentation
Update documentation when project structure, commands, configuration, or behavior changes.
