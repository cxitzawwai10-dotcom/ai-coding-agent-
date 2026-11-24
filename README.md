# AI Coding Agent

A guarded AI coding agent with ChatGPT account login, encrypted multi-account storage, model discovery, proposal review, explicit approval, workspace writes, Docker-isolated tests, and rollback.

## Requirements

- Node.js 24+
- Docker Engine for isolated workspace test execution
- A ChatGPT account eligible for ChatGPT plan usage (OpenAI currently documents Plus and Pro eligibility). Identity sign-in alone does not authorize inference.
- No OpenAI API key or Gemini key is used by this project.

## First run

```sh
npm install
npm run setup
npm start
```

The setup command creates a private `.env` file with two independent random secrets. It refuses to overwrite an existing `.env`. Keep that file private and back up the vault key separately. The browser server listens on `127.0.0.1:8787` by default.

Open `http://127.0.0.1:8787` on the same device. Enter the generated `AI_AGENT_ACCESS_TOKEN` from `.env` into the browser UI. Select **Continue with ChatGPT** to run the official loopback OAuth flow. The account's model list is fetched after connection or account switch.

## Android + self-hosted VM

The OAuth callback must reach the same local device that launched the browser. For a remote self-hosted VM, do not try to log in directly from the remote browser page.

1. Run this same app locally on Android using a local Node.js runtime and keep `AI_AGENT_HOST=127.0.0.1`.
2. Open the local browser page and complete ChatGPT sign-in where plan usage is eligible.
3. Select the account, enter a transfer passphrase of at least 16 characters, and export the encrypted credential file.
4. Transfer the file to the VM over a secure channel. Send the passphrase separately.
5. On the VM, run `npm run setup`, configure Caddy or another trusted HTTPS reverse proxy, and keep the app bound to `127.0.0.1:8787` behind that proxy. Set `AI_AGENT_ALLOW_OAUTH=false`; this disables remote OAuth while keeping the app port off the public interface. See `deploy/README.md` for systemd and Caddy templates.
6. Open the VM browser page over HTTPS, enter the VM's `AI_AGENT_ACCESS_TOKEN`, import the encrypted credential file, and verify model discovery.

The transfer file uses scrypt + AES-256-GCM. It includes only the selected ChatGPT registration and encrypted transfer payload; it does not include either installation's vault key or host ID. The VM creates/preserves its own host ID and re-encrypts the imported tokens under its vault key. Treat the file as a bearer credential while its passphrase is known.

A local Android install can perform the sign-in and export step even if Docker is unavailable. Actual coding execution and tests should run on a Docker-enabled host. Android device sign-in/export and remote VM import still require real-device verification.

## Security behavior

- ChatGPT OAuth uses Authorization Code + PKCE, state, nonce, ID-token signature validation, and the issued client ID.
- Access/refresh/ID tokens are encrypted at rest using AES-256-GCM.
- Account switching cancels active model/inference requests and refreshes models for the selected account.
- Both model discovery and Responses API inference use the fixed base URL `https://api.openai.com/v1`.
- Responses are streamed with `store:false`; completion is accepted only after `response.completed`.
- API keys, ChatGPT cookies, private session endpoints, and silent API-billing fallback are not used.
- The browser API is protected by a separate bearer token. Use HTTPS when accessing a remote VM and never expose the service directly to the public internet.
- Code changes are restricted to inspected paths, displayed in full within the proposal review limit, and require explicit user approval before writes and tests.

## Tests

```sh
npm test
```

The Docker integration test may be skipped on hosts without Docker. A passing GitHub CI run does not replace real Android OAuth, remote transfer, HTTPS, or device-level testing.
