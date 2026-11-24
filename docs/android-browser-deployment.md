# Android Browser and ChatGPT OAuth Deployment

## Current supported mode
The Sign in with ChatGPT open-source plan-usage flow uses a loopback callback such as http://127.0.0.1:<port>/auth/openai/callback. The AI Coding Agent must therefore run on the same device/environment that opens the system browser. The app binds to 127.0.0.1 by default.

A remote Node.js host accessed from an Android browser cannot receive the phone's loopback callback. This repository deliberately refuses ChatGPT plan OAuth when AI_AGENT_HOST is set to a remote interface. Do not work around this with a localhost substitution, cookie scraping, or ChatGPT private endpoints.

OpenAI documents a supported self-hosted-VM path: complete OAuth locally with the same tool/client, then securely transfer the protected credential record to the VM and preserve that VM's own host ID. This repository now implements a passphrase-encrypted credential-transfer/import wizard for the VM step. The Android-local runtime still must be started on the phone for the initial loopback callback; that Android device flow has not yet been verified. For paid or remotely hosted products outside the self-hosted-VM workflow, OpenAI requires its interest/approval process.

## Environment
- AI_AGENT_VAULT_KEY: high-entropy secret, at least 32 characters; encrypts OAuth tokens at rest.
- AI_AGENT_ACCESS_TOKEN: separate high-entropy local browser API bearer token, at least 32 characters.
- AI_AGENT_HOST: keep 127.0.0.1 for local loopback mode and for a VM behind a loopback-only HTTPS reverse proxy.
- AI_AGENT_ALLOW_OAUTH: set false on the VM to disable OAuth even when the server binds to 127.0.0.1; local Android sign-in keeps it true.
- PORT: optional port, default 8787.
- Node.js 24 or newer.
- A persistent writable .agent-data directory.
- Docker Engine access for the isolated workspace test runner.

Never commit secrets or OAuth credentials. Do not put tokens in project memory, task descriptions, or logs. Back up the encrypted account data and vault key separately.

## ChatGPT account behavior
- Add each ChatGPT account through the official OAuth browser flow.
- Each issued client ID and verified account identity is stored separately.
- Account switch cancels in-flight model requests, selects the chosen account, and refreshes /v1/models.
- All model and inference traffic uses https://api.openai.com/v1. Responses use /responses with store:false and stream:true.
- The app does not silently fall back to API billing or another account when permission or usage limits fail.
- ChatGPT plan usage requires the chatgpt.tokens.use.direct scope and an eligible ChatGPT plan. Identity-only sign-in is not AI inference authorization.

## Remote hosting
Do not deploy this open-source loopback OAuth path as a remote web login. For a self-hosted VM, the supported pattern is local OAuth followed by secure credential transfer, with the VM's host ID preserved; the encrypted transfer/import flow is implemented, but requires real-device verification. For a paid or remotely hosted product outside that VM workflow, first obtain OpenAI approval through the documented interest process and implement the exact approved redirect/client model.


## Android-to-self-hosted-VM credential transfer

The browser app now supports an encrypted transfer file for the documented self-hosted-VM pattern:

1. Run this same open-source app locally on the Android device (for example, through a local Node.js runtime) and open its 127.0.0.1 browser page.
2. Sign in to ChatGPT locally and grant plan-usage permission where eligible.
3. Select the connected account, enter a strong transfer passphrase (at least 16 characters), and export the encrypted credential file.
4. Transfer the encrypted file to the self-hosted VM over a secure channel. Transfer the passphrase separately; never send either in a public chat or commit them to Git.
5. On the VM's browser page, use the same app's Import Credential File control and enter the passphrase. The VM creates/preserves its own stable host ID and re-encrypts credentials under its own AI_AGENT_VAULT_KEY.
6. Confirm the model list and a small inference request on the VM before using the coding agent.

The transfer bundle uses scrypt plus AES-256-GCM authenticated encryption. It contains the selected registration's issued client ID, validated account identity, granted scopes, and tokens. It does not contain the source host ID or either installation's vault key. Do not reuse a transfer file after you no longer need it; delete temporary copies securely. A transfer bundle is a bearer credential while its passphrase is known.

This removes the need for a remote browser callback, but it does not eliminate the initial local sign-in step or the user's need to move the encrypted file and passphrase to the VM. The app has not yet been tested end-to-end on an actual Android device.

## Release checks
- Run CI and inspect every job result.
- Verify the OAuth callback on the same local device that launched authorization.
- Verify token refresh and account switching with two eligible ChatGPT accounts.
- Verify streaming reaches response.completed.
- Verify Android device behavior, persistent storage, Docker sandbox, backups, and access controls.
- Complete OpenAI approval before any remote-hosted ChatGPT plan usage.
