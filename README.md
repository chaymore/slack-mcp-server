# Slack MCP Server

Connect one or more Slack workspaces to Claude Code. Claude can read your channels, search messages, send DMs, and post in channels — across multiple workspaces at once.

This is an MCP (Model Context Protocol) server that runs locally on your machine. Your Slack tokens never leave your computer.

## What you can do with it

Once it's set up, you can ask Claude things like:

- "What did I miss in #general on my leland workspace today?"
- "Search my personal Slack for messages about the meetup"
- "Send a DM to @kristen saying I'll be 5 minutes late"
- "Summarize the last 50 messages in #ai-boot-camp"

## Prerequisites

You need two things installed before starting:

1. **Node.js** — check by running `node --version` in your terminal. If you get an error, install it from [nodejs.org](https://nodejs.org).
2. **Claude Code** — the CLI tool. If you're reading this you probably have it, but check with `claude --version`.

## Setup

Run these three commands in your terminal:

```bash
git clone https://github.com/chaymore/slack-mcp-server.git
cd slack-mcp-server
npm install && node setup.js
```

The setup wizard will walk you through:
1. Creating a Slack app at api.slack.com/apps
2. Adding the right permissions
3. Copying your User OAuth Token and pasting it in
4. Repeating for any additional workspaces

When the wizard finishes, it prints one more command to register the server with Claude Code — copy and run that.

Then restart Claude Code, and you're done.

## Adding more workspaces later

Just run the setup wizard again:

```bash
cd slack-mcp-server
node setup.js
```

It remembers your existing workspaces and lets you add more.

## Available tools

Once connected, Claude has access to these tools:

| Tool | What it does |
|---|---|
| `slack_list_workspaces` | Lists all workspaces you've connected |
| `slack_list_channels` | Lists channels in a workspace |
| `slack_read_messages` | Reads recent messages from a channel |
| `slack_send_message` | Posts a message to a channel |
| `slack_reply_to_thread` | Replies to a specific message thread |
| `slack_search` | Searches messages across a workspace |
| `slack_list_users` | Lists users in a workspace |
| `slack_get_user_info` | Gets info about a specific user |
| `slack_send_dm` | Sends a direct message to a user |

Every tool takes a `workspace` parameter so Claude knows which Slack account you mean.

## Troubleshooting

**"That doesn't look like a User OAuth Token"** — You probably copied the Bot User OAuth Token by mistake. Go back to the OAuth & Permissions page and copy the one labeled **User OAuth Token** (starts with `xoxp-`).

**"Your workspace requires admin approval"** — Some Slack workspaces require an admin to approve new apps. When you click "Install to Workspace", Slack will send a request to your admin. Once they approve it, come back and grab the token.

**The tools don't show up in Claude Code** — Make sure you ran the `claude mcp add` command the wizard printed, and then fully restarted Claude Code (quit and reopen, not just a new conversation).

**"Unknown workspace"** — The workspace name you used in the command doesn't match what you entered during setup. Run `node setup.js` again to see your configured workspaces, or ask Claude to use `slack_list_workspaces`.

## Security

Your Slack tokens are stored in `config.json` inside this folder, which is in `.gitignore` so it won't get committed to git. The server only runs when Claude Code is using it, and only talks to the Slack API — nothing else.

Treat your `xoxp-` tokens like passwords. Anyone with one of these tokens can act as you in Slack.

## How it works (for the curious)

This is a Node.js program that implements the [Model Context Protocol](https://modelcontextprotocol.io). When Claude Code starts, it launches this server as a subprocess and talks to it over stdin/stdout. When you ask Claude to do something Slack-related, it calls one of the tools defined in `index.js`, which makes a request to the Slack Web API using the token for the right workspace.

If you want to understand the code, `index.js` is where all the tools are defined and `setup.js` is the interactive config wizard. Both are pretty readable — good examples of what a simple MCP server looks like.
