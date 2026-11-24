# Android Browser and ChatGPT OAuth Deployment

## Current supported mode
The Sign in with ChatGPT open-source plan-usage flow uses a loopback callback such as http://127.0.0.1:<port>/auth/openai/callback. The AI Coding Agent must therefore run on the same device/environment that opens the system browser. The app binds to 127.0.0.1 by default.

A remote Node.js host accessed from an Android browser cannot receive the phone's loopback callback. This repository deliberately refuses ChatGPT plan OAuth when AI_AGENT_HOST is set to a remote interface. Do not work around this with a localhost substitution, cookie scraping, or ChatGPT private endpoints.

OpenAI's current Sign in with ChatGPT docs say open-source plan usage is for open-source/local-hosted apps; paid or remotely hosted apps should complete the OpenAI interest form. Remote-host deployment requires OpenAI's approval and the supported redirect/client configuration before enabling the OAuth flow.

## Environment
- AI_AGENT_VAULT_KEY: high-entropy secret, at least 32 characters; encrypts OAuth tokens at rest.
- AI_AGENT_ACCESS_TOKEN: separate high-entropy local browser API bearer token, at least 32 characters.
- AI_AGENT_HOST: keep 127.0.0.1 for the supported local loopback flow. Remote binding disables ChatGPT OAuth.
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
Do not deploy this open-source loopback OAuth path as a remote web login. For a remote-hosted product, first obtain OpenAI approval through the documented interest process and implement the exact approved redirect/client model. The existing remote browser service may still host other non-OAuth UI, but ChatGPT plan inference remains disabled there.

## Release checks
- Run CI and inspect every job result.
- Verify the OAuth callback on the same local device that launched authorization.
- Verify token refresh and account switching with two eligible ChatGPT accounts.
- Verify streaming reaches response.completed.
- Verify Android device behavior, persistent storage, Docker sandbox, backups, and access controls.
- Complete OpenAI approval before any remote-hosted ChatGPT plan usage.
