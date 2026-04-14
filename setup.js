import { createInterface } from "readline";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { WebClient } from "@slack/web-api";

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, "config.json");

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

const W = 55;
const row = (text) => `║${text.padEnd(W)}║`;

console.log(`
╔${"═".repeat(W)}╗
${row("         Slack MCP Server — Workspace Setup")}
╠${"═".repeat(W)}╣
${row("  This will connect your Slack workspaces to Claude")}
${row("  Code. You'll need a User OAuth Token for each one.")}
${row("  This lets Claude access Slack as you — it can see")}
${row("  everything you can, no extra setup needed.")}
${row("")}
${row("  To get a token:")}
${row("  1. Go to https://api.slack.com/apps")}
${row('  2. Click "Create New App" → "From scratch"')}
${row('  3. Name it anything (e.g. "Claude Bridge")')}
${row("  4. Pick the workspace to install it in")}
${row('  5. Go to "OAuth & Permissions" in the sidebar')}
${row('  6. Under "Scopes → User Token Scopes", add:')}
${row("     • channels:history   • channels:read")}
${row("     • chat:write         • groups:history")}
${row("     • groups:read        • im:history")}
${row("     • im:read            • im:write")}
${row("     • users:read         • users.profile:read")}
${row("     • search:read")}
${row('  7. Click "Install to Workspace" at the top')}
${row('  8. Copy the "User OAuth Token" (starts with xoxp-)')}
${row("")}
${row("  Note: Some workspaces require admin approval to")}
${row("  install apps. If so, your admin will get a request.")}
${row("")}
${row("  Then come back here and paste it when prompted.")}
╚${"═".repeat(W)}╝
`);

// Load existing config
let config = { workspaces: {} };
if (existsSync(configPath)) {
  try {
    config = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    console.log("Warning: config.json is corrupted. Starting fresh.\n");
    config = { workspaces: {} };
  }
  const existing = Object.keys(config.workspaces);
  if (existing.length > 0) {
    console.log(`Already connected: ${existing.join(", ")}\n`);
  }
}

async function addWorkspace() {
  const name = await ask(
    'Workspace nickname (this is just a label for you, e.g. "leland"): '
  );
  if (!name.trim()) {
    console.log("Skipped — no name entered.\n");
    return;
  }

  const token = await ask("User OAuth Token (xoxp-...): ");
  if (!token.trim().startsWith("xoxp-")) {
    console.log(
      'That doesn\'t look like a User OAuth Token (should start with "xoxp-"). Try again.\n'
    );
    return;
  }

  console.log("Verifying token...");
  try {
    const client = new WebClient(token.trim());
    const auth = await client.auth.test();
    console.log(`  ✓ Authenticated as ${auth.user} in ${auth.team}\n`);
  } catch (err) {
    console.log(
      `  ✗ Token is invalid or expired: ${err.data?.error || err.message}\n` +
        "  Check that you copied the full token and that the app is still installed.\n"
    );
    return;
  }

  config.workspaces[name.trim()] = token.trim();
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`  ✓ "${name.trim()}" saved.\n`);
}

async function removeWorkspace() {
  const names = Object.keys(config.workspaces);
  if (names.length === 0) {
    console.log("No workspaces to remove.\n");
    return;
  }

  console.log("Connected workspaces:");
  names.forEach((n, i) => console.log(`  ${i + 1}. ${n}`));
  const choice = await ask(
    "Enter the number or name to remove (or press Enter to cancel): "
  );
  if (!choice.trim()) return;

  let target = choice.trim();
  const index = parseInt(target, 10);
  if (!isNaN(index) && index >= 1 && index <= names.length) {
    target = names[index - 1];
  }

  if (!config.workspaces[target]) {
    console.log(`Workspace "${target}" not found.\n`);
    return;
  }

  delete config.workspaces[target];
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`  ✓ "${target}" removed.\n`);
}

async function main() {
  if (Object.keys(config.workspaces).length === 0) {
    console.log("Let's add your first workspace.\n");
    await addWorkspace();
  }

  let done = false;
  while (!done) {
    const action = await ask(
      "What would you like to do? (a)dd / (r)emove / (d)one: "
    );
    switch (action.trim().toLowerCase()) {
      case "a":
      case "add":
        await addWorkspace();
        break;
      case "r":
      case "remove":
        await removeWorkspace();
        break;
      case "d":
      case "done":
      case "":
        done = true;
        break;
      default:
        console.log('Enter "a" to add, "r" to remove, or "d" when done.\n');
    }
  }

  const count = Object.keys(config.workspaces).length;
  if (count === 0) {
    console.log("\nNo workspaces configured. Run this again when you're ready.");
  } else {
    console.log(`
  ✓ ${count} workspace(s) configured.

  Claude can now access everything you can see in Slack —
  all your channels, DMs, and messages. No extra setup needed.

  To register the server with Claude Code, run:

    claude mcp add slack-multi node ${join(__dirname, "index.js")}

  Then restart Claude Code and you'll have Slack tools available.
`);
  }

  rl.close();
}

main();
