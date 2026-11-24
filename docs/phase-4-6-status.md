# Phase 4-6 Implementation Status

## Phase 4 — ChatGPT account login and plan usage
- Replaced the Gemini/OpenAI API-key provider path with a ChatGPT-only account architecture based on OpenAI's documented Sign in with ChatGPT open-source OAuth flow.
- Added a persistent encrypted account store (AES-256-GCM), supports up to 100 user-managed accounts, and stores each account's issued OAuth client ID, verified identity, scopes, access token, refresh token, and ID token separately.
- Added OAuth Authorization Code + PKCE, fresh state and nonce, a persistent per-host ext_agent_host_id, callback client-ID binding checks, OpenAI JWKS signature validation, and issuer/audience/expiry/nonce checks.
- Account switching cancels in-flight Responses requests, changes the active account, and fetches that account's current model catalog. Both model discovery and inference use the fixed public API base https://api.openai.com/v1; inference uses /responses, store:false, and stream:true, and is successful only after response.completed.
- No ChatGPT browser cookies, private session endpoints, API keys, or silent billing fallback are used. Identity-only sign-in does not enable inference: the chatgpt.tokens.use.direct scope is required.
- **Important deployment boundary:** the documented open-source plan-usage flow uses a 127.0.0.1 loopback callback. This implementation deliberately disables OAuth when the service is bound to a remote host. OpenAI documents a self-hosted-VM option: complete OAuth locally with the same tool/client and securely transfer the protected credential record to the VM, preserving the VM's host ID. This repository does not yet include the local Android callback bridge or secure credential-transfer/import flow. Paid or remotely hosted products outside the documented self-hosted-VM workflow require OpenAI's approval/interest process. The current Android-browser-only remote deployment is therefore not end-to-end ready.
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
- Added passphrase-encrypted credential export/import (scrypt + AES-256-GCM) to support OpenAI's self-hosted-VM transfer workflow. Import binds the account to the destination host's stable ID and re-encrypts credentials with the destination vault key.
- Model discovery and inference now bind to an account snapshot; account switches abort model and Responses requests and prevent stale model results from replacing the selected account's catalog.
- Coding changes are restricted to inspected paths at the AgentCore boundary, and the approval preview now includes complete file contents under a 2 MiB total review limit.
- npm start launches the browser server; the default listener is 127.0.0.1:8787.
- **Not complete:** no Android-device end-to-end sign-in/transfer test, cloud host provisioning, TLS reverse proxy, or user-device deployment has been verified. The encrypted self-hosted-VM transfer flow is implemented but still needs a real Android local sign-in and remote VM test. Commercial/remote-hosted use outside OpenAI's documented self-hosted-VM flow still requires OpenAI approval. GitHub CI cannot establish these external release conditions.
