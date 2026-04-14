import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebClient } from "@slack/web-api";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

// Load config
const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, "config.json");

if (!existsSync(configPath)) {
  console.error(
    "No config.json found. Run 'node setup.js' to add your Slack workspaces."
  );
  process.exit(1);
}

let config;
try {
  config = JSON.parse(readFileSync(configPath, "utf-8"));
} catch {
  console.error(
    "config.json is corrupted. Run 'node setup.js' to reconfigure your workspaces."
  );
  process.exit(1);
}

const workspaces = config.workspaces || {};
const workspaceNames = Object.keys(workspaces);

if (workspaceNames.length === 0) {
  console.error(
    "No workspaces configured. Run 'node setup.js' to add your Slack workspaces."
  );
  process.exit(1);
}

// Create a Slack client for each workspace
const clients = {};
for (const [name, token] of Object.entries(workspaces)) {
  clients[name] = new WebClient(token);
}

// Helper to get the right client
function getClient(workspace) {
  const client = clients[workspace];
  if (!client) {
    throw new Error(
      `Unknown workspace "${workspace}". Available: ${workspaceNames.join(", ")}`
    );
  }
  return client;
}

// Resolve #channel-name to a channel ID
async function resolveChannelId(client, channel) {
  if (!channel.startsWith("#")) return channel;
  const channelName = channel.slice(1);
  const list = await client.conversations.list({
    types: "public_channel,private_channel",
    limit: 1000,
  });
  const found = (list.channels || []).find((c) => c.name === channelName);
  if (!found) throw new Error(`Channel #${channelName} not found`);
  return found.id;
}

// Resolve @username to a user ID
async function resolveUserId(client, user) {
  if (!user.startsWith("@")) return user;
  const username = user.slice(1);
  const list = await client.users.list({ limit: 1000 });
  const found = (list.members || []).find((u) => u.name === username);
  if (!found) throw new Error(`User @${username} not found`);
  return found.id;
}

// Build the MCP server
const server = new McpServer({
  name: "slack-multi",
  version: "1.0.0",
});

// --- Tools ---

server.tool(
  "slack_list_workspaces",
  "List all connected Slack workspaces",
  {},
  async () => {
    return {
      content: [
        {
          type: "text",
          text: `Connected workspaces:\n${workspaceNames.map((n) => `• ${n}`).join("\n")}`,
        },
      ],
    };
  }
);

server.tool(
  "slack_list_channels",
  "List channels in a Slack workspace",
  {
    workspace: z
      .enum(workspaceNames)
      .describe("Which Slack workspace to use"),
    include_private: z
      .boolean()
      .default(false)
      .describe("Include private channels you have access to"),
  },
  async ({ workspace, include_private }) => {
    const client = getClient(workspace);
    const types = include_private
      ? "public_channel,private_channel"
      : "public_channel";
    const result = await client.conversations.list({
      types,
      limit: 200,
      exclude_archived: true,
    });
    const channels = (result.channels || []).map(
      (ch) => `#${ch.name} (${ch.id}) — ${ch.purpose?.value || "no description"}`
    );
    return {
      content: [{ type: "text", text: channels.join("\n") || "No channels found." }],
    };
  }
);

server.tool(
  "slack_read_messages",
  "Read recent messages from a Slack channel",
  {
    workspace: z
      .enum(workspaceNames)
      .describe("Which Slack workspace to use"),
    channel: z.string().describe("Channel ID (e.g. C01ABC123) or #channel-name"),
    count: z.number().default(20).describe("Number of messages to read (max 100)"),
  },
  async ({ workspace, channel, count }) => {
    const client = getClient(workspace);
    const channelId = await resolveChannelId(client, channel);

    const result = await client.conversations.history({
      channel: channelId,
      limit: Math.min(count, 100),
    });

    // Fetch user info for display names
    const userCache = {};
    async function getUserName(userId) {
      if (!userId) return "unknown";
      if (userCache[userId]) return userCache[userId];
      try {
        const info = await client.users.info({ user: userId });
        const name =
          info.user?.real_name || info.user?.name || userId;
        userCache[userId] = name;
        return name;
      } catch {
        userCache[userId] = userId;
        return userId;
      }
    }

    const messages = [];
    for (const msg of (result.messages || []).reverse()) {
      const name = await getUserName(msg.user);
      const time = new Date(parseFloat(msg.ts) * 1000).toLocaleString();
      messages.push(`[${time}] ${name}: ${msg.text}`);
    }

    return {
      content: [
        {
          type: "text",
          text: messages.join("\n") || "No messages found.",
        },
      ],
    };
  }
);

server.tool(
  "slack_send_message",
  "Send a message to a Slack channel",
  {
    workspace: z
      .enum(workspaceNames)
      .describe("Which Slack workspace to use"),
    channel: z.string().describe("Channel ID or #channel-name"),
    text: z.string().describe("Message text to send"),
  },
  async ({ workspace, channel, text }) => {
    const client = getClient(workspace);
    const channelId = await resolveChannelId(client, channel);

    const result = await client.chat.postMessage({
      channel: channelId,
      text,
    });

    return {
      content: [
        {
          type: "text",
          text: `Message sent to ${channel} in ${workspace}. Timestamp: ${result.ts}`,
        },
      ],
    };
  }
);

server.tool(
  "slack_reply_to_thread",
  "Reply to a specific message thread in Slack",
  {
    workspace: z
      .enum(workspaceNames)
      .describe("Which Slack workspace to use"),
    channel: z.string().describe("Channel ID or #channel-name"),
    thread_ts: z.string().describe("Timestamp of the parent message to reply to"),
    text: z.string().describe("Reply text"),
  },
  async ({ workspace, channel, thread_ts, text }) => {
    const client = getClient(workspace);
    const channelId = await resolveChannelId(client, channel);

    const result = await client.chat.postMessage({
      channel: channelId,
      text,
      thread_ts,
    });

    return {
      content: [
        {
          type: "text",
          text: `Reply sent in ${workspace}. Timestamp: ${result.ts}`,
        },
      ],
    };
  }
);

server.tool(
  "slack_search",
  "Search messages across a Slack workspace",
  {
    workspace: z
      .enum(workspaceNames)
      .describe("Which Slack workspace to use"),
    query: z.string().describe("Search query"),
    count: z.number().default(10).describe("Number of results (max 50)"),
  },
  async ({ workspace, query, count }) => {
    const client = getClient(workspace);
    const result = await client.search.messages({
      query,
      count: Math.min(count, 50),
    });

    const matches = (result.messages?.matches || []).map((m) => {
      const time = new Date(parseFloat(m.ts) * 1000).toLocaleString();
      return `[${time}] #${m.channel?.name || "?"} — ${m.username || "?"}: ${m.text}`;
    });

    return {
      content: [
        {
          type: "text",
          text: matches.join("\n\n") || "No results found.",
        },
      ],
    };
  }
);

server.tool(
  "slack_list_users",
  "List users in a Slack workspace",
  {
    workspace: z
      .enum(workspaceNames)
      .describe("Which Slack workspace to use"),
  },
  async ({ workspace }) => {
    const client = getClient(workspace);
    const result = await client.users.list({ limit: 200 });
    const users = (result.members || [])
      .filter((u) => !u.deleted && !u.is_bot && u.id !== "USLACKBOT")
      .map(
        (u) =>
          `${u.real_name || u.name} (@${u.name}) — ${u.profile?.title || "no title"}`
      );

    return {
      content: [{ type: "text", text: users.join("\n") || "No users found." }],
    };
  }
);

server.tool(
  "slack_get_user_info",
  "Get detailed info about a Slack user",
  {
    workspace: z
      .enum(workspaceNames)
      .describe("Which Slack workspace to use"),
    user: z.string().describe("User ID (e.g. U01ABC123) or @username"),
  },
  async ({ workspace, user }) => {
    const client = getClient(workspace);
    const userId = await resolveUserId(client, user);

    const info = await client.users.info({ user: userId });
    const u = info.user;

    const details = [
      `Name: ${u.real_name || u.name}`,
      `Username: @${u.name}`,
      `Title: ${u.profile?.title || "none"}`,
      `Email: ${u.profile?.email || "hidden"}`,
      `Status: ${u.profile?.status_text || "none"}`,
      `Timezone: ${u.tz_label || u.tz || "unknown"}`,
      `Admin: ${u.is_admin ? "yes" : "no"}`,
    ];

    return {
      content: [{ type: "text", text: details.join("\n") }],
    };
  }
);

server.tool(
  "slack_send_dm",
  "Send a direct message to a user",
  {
    workspace: z
      .enum(workspaceNames)
      .describe("Which Slack workspace to use"),
    user: z.string().describe("User ID (e.g. U01ABC123) or @username"),
    text: z.string().describe("Message text"),
  },
  async ({ workspace, user, text }) => {
    const client = getClient(workspace);
    const userId = await resolveUserId(client, user);

    // Open a DM channel
    const dm = await client.conversations.open({ users: userId });
    const channelId = dm.channel.id;

    const result = await client.chat.postMessage({
      channel: channelId,
      text,
    });

    return {
      content: [
        {
          type: "text",
          text: `DM sent to ${user} in ${workspace}. Timestamp: ${result.ts}`,
        },
      ],
    };
  }
);

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
