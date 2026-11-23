# Repository Guidelines

## Project Goal
Build a local AI Coding Agent for Android using Termux and Ubuntu. The agent should support Burmese conversations, project management, code editing, debugging, testing, and persistent project memory.

## Project Structure
Keep source code organized into clear modules. Separate the agent core, account manager, project manager, memory, backup, safety, and user interface. Keep tests separate from application source code.

## Development Rules
- Inspect existing files before modifying them.
- Never overwrite or delete user data without explicit approval.
- Make backups before significant changes.
- Keep modules small and maintainable.
- Explain important changes in clear Burmese.
- Do not hardcode API keys, passwords, or access tokens.

## Security
- Require approval for operations outside the project workspace.
- Never expose authentication credentials.
- Do not implement account switching to evade provider quotas or usage limits.
- Follow provider authentication rules and service terms.

## Testing
Run syntax checks and relevant tests after each meaningful change. Report actual results and do not claim tests passed without verification.

## Documentation
Update documentation when project structure, commands, configuration, or behavior changes.
