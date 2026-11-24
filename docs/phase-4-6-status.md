# Phase 4-6 Implementation Status

## Phase 4 — ChatGPT account login and plan usage
- Replaced the Gemini/OpenAI API-key provider path with a ChatGPT-only account architecture based on OpenAI's documented Sign in with ChatGPT open-source OAuth flow.
- Added a persistent encrypted account store (AES-256-GCM), supports up to 100 user-managed accounts, and stores each account's issued OAuth client ID, verified identity, scopes, access token, refresh token, and ID token separately.
- Added OAuth Authorization Code + PKCE, fresh state and nonce, a persistent per-host ext_agent_host_id, callback client-ID binding checks, OpenAI JWKS signature validation, and issuer/audience/expiry/nonce checks.
- Account switching cancels in-flight Responses requests, changes the active account, and fetches that account's current model catalog. Both model discovery and inference use the fixed public API base https://api.openai.com/v1; inference uses /responses, store:false, and stream:true, and is successful only after response.completed.
- No ChatGPT browser cookies, private session endpoints, API keys, or silent billing fallback are used. Identity-only sign-in does not enable inference: the chatgpt.tokens.use.direct scope is required.
- **Important deployment boundary:** the documented open-source plan-usage flow uses a 127.0.0.1 loopback callback and is intended for open-source/local-hosted apps. This implementation deliberately disables plan OAuth when the service is bound to a remote host. OpenAI says paid or remotely hosted apps should submit its interest form. Remote Android-browser deployment therefore remains blocked until the architecture is local-hosted or OpenAI approves the remote-hosted integration.
- **Plan eligibility:** OpenAI's current documentation describes ChatGPT plan usage for eligible Plus and Pro users. A Free account may be able to authenticate for identity in other supported integrations, but this does not establish eligibility for plan inference. No inference is claimed unless OpenAI grants the required scope.
- AI_AGENT_VAULT_KEY (32+ characters) encrypts saved OAuth credentials. AI_AGENT_ACCESS_TOKEN (32+ characters) protects the local browser API.

## Phase 5 — autonomous coding engine
- Retained the two-step workflow: propose relative paths, inspect those paths inside the workspace, then generate complete file contents only for inspected paths.
- Proposals are bounded to 20 files and 1 MiB per file, then require user review and explicit approval before applying.
- Approved writes run through the existing workspace approval and Docker-isolated test path; failures are handled by the existing rollback workflow.
- Provider output remains untrusted. This is a guarded proposal-and-apply engine, not unrestricted self-modifying execution.

## Phase 6 — Android browser interface and integration
- Added a responsive Burmese-first browser UI for ChatGPT account connection, account listing/switching, model selection, proposal review, and apply-and-test.
- The local OAuth callback is handled only by the loopback-bound server. Remote-host mode returns a clear limitation instead of pretending login worked.
- npm start launches the browser server; the default listener is 127.0.0.1:8787.
- **Not complete:** no cloud host, OpenAI remote-host approval, Android-native local callback bridge, TLS reverse proxy, or device end-to-end deployment has been provisioned or verified. GitHub CI cannot establish these external release conditions.
