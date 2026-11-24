# Android local run (Termux)

This is the supported local Android test path. It runs the Node.js server on the phone, so the Sign in with ChatGPT loopback callback returns to the same Android device.

## One-time setup

1. Install the official Termux app from F-Droid or the official Termux GitHub releases. Avoid obsolete Play Store builds.
2. Open Termux and run:

```sh
pkg update -y && pkg upgrade -y
pkg install -y git nodejs npm
git clone --branch security/phase-2-hardening https://github.com/cxitzawwai10-dotcom/ai-coding-agent-.git "$HOME/ai-coding-agent"
cd "$HOME/ai-coding-agent"
bash scripts/termux-start.sh
```

3. The script checks for Node.js 24+, installs the project packages, creates a private `.env` on first run, and starts the server.
4. Keep Termux open. In Chrome on the same phone, visit `http://127.0.0.1:8787`.
5. Copy the **App Access Token** printed by the script into the browser page. It is a local secret: do not share it or post a screenshot containing it.
6. Choose **Continue with ChatGPT**. The callback listener stays active in Termux and uses the documented `http://127.0.0.1:<port>/auth/callback` path.

## Start it again later

```sh
cd "$HOME/ai-coding-agent"
bash scripts/termux-start.sh
```

## Stop and restart

Press `CTRL+C` in Termux to stop the server. Run the start command again when needed. Keep the app in the foreground during OAuth; Android battery/background restrictions may stop long-running Termux processes.

## Android limitations

- This is a local browser app, not an APK. It opens in Chrome on the same phone.
- Android local runtime can perform the local sign-in and encrypted credential export steps. Docker-based code execution/testing is intended for a Docker-enabled host (for example, the self-hosted VM), not standard Android Termux.
- ChatGPT plan inference works only if OpenAI grants `chatgpt.tokens.use.direct` and the account is eligible. Sign-in alone does not guarantee inference access.
- The phone must be online during OAuth and inference.
- This setup has not been run on the user's physical phone from this environment. Complete the first-run steps on the device to verify browser callback, persistent storage, and account eligibility.

## Troubleshooting

- If `pkg` is not found, confirm that you installed Termux, not a different terminal emulator.
- If Node.js is below 24, run `pkg update && pkg upgrade && pkg install nodejs npm`, then restart Termux.
- If port 8787 is already in use, stop the older server session before starting again.
- If Chrome cannot open the local page, confirm Termux still shows "Browser server listening" and try `http://127.0.0.1:8787` (not `localhost`).
