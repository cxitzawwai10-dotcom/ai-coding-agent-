import { randomBytes } from "node:crypto";
import { open } from "node:fs/promises";
import path from "node:path";

const filePath = path.resolve(process.cwd(), ".env");
const values = [
  "# Generated locally. Never commit or share this file.",
  "AI_AGENT_VAULT_KEY=" + randomBytes(48).toString("base64url"),
  "AI_AGENT_ACCESS_TOKEN=" + randomBytes(48).toString("base64url"),
  "AI_AGENT_HOST=127.0.0.1",
  "PORT=8787",
  ""
].join("\n");

let handle;
try {
  handle = await open(filePath, "wx", 0o600);
  await handle.writeFile(values, "utf8");
  await handle.sync();
  console.log("Created .env with fresh random secrets (owner-only permissions).");
  console.log("Keep .env private. The vault key is required to decrypt saved ChatGPT credentials.");
} catch (error) {
  if (error.code === "EEXIST") {
    console.error(".env already exists; it was not overwritten.");
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  await handle?.close();
}
