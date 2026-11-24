# Self-hosted VM deployment templates

These templates do not provision a VM, DNS, firewall, or TLS certificate. They provide a safer starting point after you have a Linux VM with Node.js 24+, Docker Engine, and Caddy installed.

## Security model

- The app binds to 127.0.0.1:8787; Caddy terminates HTTPS and proxies locally.
- AI_AGENT_ALLOW_OAUTH=false disables loopback OAuth on the VM even though the app binds to loopback. Sign in on the local Android runtime, then import the encrypted credential bundle.
- Do not expose port 8787 publicly. Allow inbound 80/443 only (plus restricted SSH).
- The service account is added to the docker group because the coding agent invokes Docker for isolated tests. Membership in the docker group is effectively root-equivalent. Use a dedicated VM and do not run unrelated workloads or store unrelated secrets on it.
- Keep .env readable only by the service account (mode 0600); back up AI_AGENT_VAULT_KEY separately from encrypted .agent-data.
- Use a domain you control. Caddy obtains and renews TLS certificates automatically after DNS and firewall are correct.

## Install outline

1. Create a dedicated VM and point your domain DNS A/AAAA records to it.
2. Install Node.js 24+, Docker Engine, and Caddy using their official installation instructions.
3. Create a dedicated ai-coding-agent user and group. Add that user to the docker group only after accepting the root-equivalent Docker access risk.
4. Clone this repository to /opt/ai-coding-agent, install production dependencies, and run npm run setup as the service user. Keep the generated .env private.
5. Copy deploy/systemd/ai-coding-agent.service to /etc/systemd/system/ai-coding-agent.service. Confirm the repository path and Node binary path match the VM.
6. Copy deploy/caddy/Caddyfile.example to the Caddy configuration and replace agent.example.com with your domain.
7. Start Caddy and the agent service. Verify the public page is HTTPS and that port 8787 is not reachable from another machine.
8. Open the HTTPS page, enter AI_AGENT_ACCESS_TOKEN, import the encrypted credential file created on the local Android sign-in runtime, and verify the account/model list.
9. Only test inference if the account has the required granted scope and plan eligibility. Do not assume a Free account is eligible.

## Important

The service template uses ProtectSystem=strict with the repository directory writable because this agent treats its working directory as the coding workspace. For higher isolation, deploy the agent code and a separate, explicitly configured workspace directory, then update createAgent({ workspaceRoot, dataRoot }) wiring before using it.

This is a deployment template, not a verified production deployment. VM provisioning, domain ownership, firewall, TLS issuance, Android sign-in, credential transfer, and real inference still require checks on the actual infrastructure.
