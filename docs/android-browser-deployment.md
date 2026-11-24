# Android Browser Deployment Guide

This project does not require Termux or a local PC for day-to-day use. The Node.js service must first be deployed to a trusted host; the Android phone then opens the hosted HTTPS address in Chrome or another browser.

## Required host capabilities
- Node.js 24 or newer.
- A persistent writable data directory for `.agent-data`.
- Docker Engine access for the isolated workspace test runner. The runner intentionally fails closed when Docker is unavailable.
- HTTPS termination (reverse proxy or platform-managed TLS).
- Private environment-variable/secret management.

A generic static-site host is not sufficient. Do not expose the Node.js service directly over public plain HTTP.

## Environment configuration
- `AI_AGENT_VAULT_KEY`: high-entropy secret with at least 32 characters; encrypts saved provider API keys.
- `AI_AGENT_ACCESS_TOKEN`: separate high-entropy bearer token with at least 32 characters; protects all API routes.
- `AI_AGENT_HOST`: keep `127.0.0.1` when a local reverse proxy connects over loopback. Use `0.0.0.0` only when the host requires it and network access is restricted behind HTTPS/TLS and firewall controls.
- `PORT`: optional HTTP listener port; defaults to `8787`.

Never commit these values to Git or paste them into task prompts. Back up the vault data and master key separately. If the vault key is lost, encrypted provider credentials cannot be recovered.

## Start
Configure the host's start command as `npm start`. The service listens on port 8787 by default. Configure the platform's HTTPS domain to proxy to that local port.

## Android use
1. Open the deployment's HTTPS URL in the Android browser.
2. Enter the bearer access token.
3. Add a Gemini or OpenAI API account. The key is sent to the authenticated service and encrypted before persistent storage.
4. Select the intended account explicitly.
5. Submit a coding task. Inspect the returned file previews and change sizes.
6. Press the explicit approval button only after reviewing the proposed changes. The service applies the approved writes and runs the Docker-isolated test suite; failed tests trigger rollback.

## Release checks still required
- Deploy on a Docker-capable host with persistent storage and TLS.
- Set the two secrets through the host's private secret manager.
- Verify provider calls using the user's own API account and applicable provider terms/quotas.
- Complete Android browser end-to-end checks and confirm server restart persistence.
- Review backups, access controls, logs, resource limits, and host firewall rules before production use.
