#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = "https://api.gt-protocol.io/api/v1";
const AUTH_BASE = "https://api.gt-protocol.io";

let currentToken = process.env.GT_TOKEN;
const REFRESH_TOKEN = process.env.GT_REFRESH_TOKEN;

function authHeaders() {
  if (!currentToken) throw new Error("GT_TOKEN env variable is not set");
  return { Authorization: `Bearer ${currentToken}`, "Content-Type": "application/json" };
}

async function tryRefresh() {
  if (!REFRESH_TOKEN) throw new Error("Session expired and GT_REFRESH_TOKEN is not set");
  const res = await fetch(`${AUTH_BASE}/auth/refresh`, {
    method: "POST",
    headers: { Authorization: `Bearer ${REFRESH_TOKEN}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error("Session expired — please re-authenticate and update GT_TOKEN");
  const body = await res.json();
  const data = body.data ?? body;
  currentToken = data.access_token ?? data.token;
  if (!currentToken) throw new Error("Refresh succeeded but no access_token in response");
}

async function request(method, path, body) {
  const opts = { method, headers: authHeaders() };
  if (body !== undefined) opts.body = JSON.stringify(body);
  let res = await fetch(`${BASE_URL}${path}`, opts);
  if (res.status === 401) {
    await tryRefresh();
    opts.headers = authHeaders();
    res = await fetch(`${BASE_URL}${path}`, opts);
  }
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json();
}

const apiGet   = (path)        => request("GET",   path);
const apiPost  = (path, body)  => request("POST",  path, body ?? {});
const apiPatch = (path, body)  => request("PATCH", path, body ?? {});
const apiPut   = (path, body)  => request("PUT",   path, body ?? {});

const server = new McpServer({ name: "gt-protocol", version: "2.0.0" });

// Create bot
server.tool(
  "create_bot",
  "Create a new trading bot/strategy.",
  {
    bot_name: z.string().describe("Bot name"),
    exchange_name: z.string().describe("Exchange name, e.g. 'binance' or 'hyperliquid'"),
    user_exchange_name: z.string().describe("User's exchange account name, e.g. 'Demo' or 'hyper'"),
    symbol: z.string().describe("Trading pair, e.g. 'BTC/USDT'"),
    strategy_equity: z.enum(["Long", "Short"]).describe("Trading direction"),
    strategy_id: z.number().describe("Strategy ID (1 = Classic)"),
    start_order_amount: z.string().describe("Start order amount in quote currency"),
    start_order_amount_percent: z.boolean().describe("Whether start_order_amount is a % of balance"),
    safety_order_amount: z.string().describe("Safety order amount"),
    safety_order_amount_percent: z.boolean().describe("Whether safety_order_amount is a % of balance"),
    safety_order_step: z.string().describe("Safety order price step %"),
    safety_order_total: z.number().describe("Max number of safety orders"),
    safety_order_active: z.number().describe("Max simultaneous active safety orders"),
    take_profit: z.string().describe("Take profit %"),
    stop_loss: z.string().optional().describe("Stop loss %"),
    type: z.enum(["FUTURES", "SPOT"]).optional().default("FUTURES").describe("Bot type"),
    leverage: z.number().optional().default(1).describe("Leverage (futures only)"),
    margin_type: z.enum(["CROSSED", "ISOLATED"]).optional().default("CROSSED"),
    trailing_deviation: z.string().optional().describe("Trailing take profit deviation %"),
    martingale: z.string().optional().default("1").describe("Martingale multiplier"),
    martingale_step: z.string().optional().default("1").describe("Martingale step multiplier"),
    trend_changer: z.number().optional().describe("Trend changer signal threshold"),
    timeframe: z.string().optional().default("5m").describe("Bot timeframe"),
    trend_changer_timeframe: z.string().optional().default("4h"),
    paper: z.boolean().optional().default(false).describe("Demo mode (paper trading)"),
  },
  async (params) => {
    const data = await apiPost("/bot", params);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// Close deal
server.tool(
  "close_deal",
  "Close the active deal on a bot (market close). Works for both SPOT and FUTURES bots.",
  { bot_id: z.number().describe("Bot ID whose active deal should be closed") },
  async ({ bot_id }) => {
    const data = await apiPost(`/bot/deal/${bot_id}/close`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// Paper clone
server.tool(
  "paper_clone",
  "Create a paper trading (demo) copy of an existing live bot.",
  { bot_id: z.number().describe("Bot ID to clone as paper/demo bot") },
  async ({ bot_id }) => {
    const data = await apiPost(`/bot/${bot_id}/paper_clone`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// Update bot
server.tool(
  "update_bot",
  "Update settings of an existing bot/strategy.",
  {
    bot_id: z.number().describe("Bot ID to update"),
    bot_name: z.string().optional().describe("Bot name"),
    take_profit: z.string().optional().describe("Take profit %"),
    stop_loss: z.string().optional().describe("Stop loss %"),
    start_order_amount: z.string().optional().describe("Start order amount in quote currency"),
    safety_order_amount: z.string().optional().describe("Safety order amount"),
    safety_order_step: z.string().optional().describe("Safety order price step %"),
    safety_order_total: z.number().optional().describe("Max number of safety orders"),
    safety_order_active: z.number().optional().describe("Max simultaneous active safety orders"),
    trailing_deviation: z.string().optional().describe("Trailing take profit deviation %"),
    martingale: z.string().optional().describe("Martingale multiplier"),
    martingale_step: z.string().optional().describe("Martingale step multiplier"),
    trend_changer: z.number().optional().describe("Trend changer signal threshold"),
    leverage: z.number().optional().describe("Leverage (futures only)"),
  },
  async ({ bot_id, ...params }) => {
    const data = await apiPatch(`/bot/${bot_id}/update?partial=1`, params);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// List bots
server.tool(
  "list_bots",
  "List all user's strategies/bots.",
  {
    page: z.number().optional().default(1),
    limit: z.number().optional().default(20),
  },
  async ({ page, limit }) => {
    const params = new URLSearchParams({ page, limit });
    const data = await apiGet(`/bot/list?${params}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// Get bot details
server.tool(
  "get_bot",
  "Get details of a specific strategy/bot by ID.",
  { bot_id: z.number().describe("Bot ID") },
  async ({ bot_id }) => {
    const data = await apiGet(`/bot/${bot_id}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// Start bot
server.tool(
  "start_bot",
  "Activate (start) a strategy/bot.",
  { bot_id: z.number().describe("Bot ID") },
  async ({ bot_id }) => {
    const data = await apiPost(`/bot/${bot_id}/start`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// Stop bot
server.tool(
  "stop_bot",
  "Deactivate (stop) a strategy/bot.",
  { bot_id: z.number().describe("Bot ID") },
  async ({ bot_id }) => {
    const data = await apiPost(`/bot/${bot_id}/stop`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// List deals
server.tool(
  "list_deals",
  "List all deals with optional filters.",
  {
    page: z.number().optional().default(1),
    limit: z.number().optional().default(20),
    bot_id: z.number().optional().describe("Filter by bot ID"),
  },
  async ({ page, limit, bot_id }) => {
    const params = new URLSearchParams({ page, limit });
    if (bot_id) params.set("bot_id", bot_id);
    const data = await apiGet(`/bot/list_deals?${params}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// Active deals
server.tool(
  "get_active_deals",
  "Get all currently active deals.",
  {},
  async () => {
    const data = await apiGet("/user/deals/active");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// Deal history
server.tool(
  "get_deal_history",
  "Get deal history with total profit.",
  {
    page: z.number().optional().default(1),
    limit: z.number().optional().default(20),
  },
  async ({ page, limit }) => {
    const params = new URLSearchParams({ page, limit });
    const data = await apiGet(`/user/deals/history?${params}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// Get balance
server.tool(
  "get_balance",
  "Get exchange account balance.",
  { user_exchange_id: z.number().describe("User exchange account ID") },
  async ({ user_exchange_id }) => {
    const data = await apiGet(`/exchange/balance/${user_exchange_id}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// Get exchanges
server.tool(
  "get_exchanges",
  "List connected exchange accounts.",
  {},
  async () => {
    const data = await apiGet("/exchange");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// Get profile
server.tool(
  "get_profile",
  "Get current user profile and stats.",
  {},
  async () => {
    const [me, info] = await Promise.all([
      apiGet("/user/me"),
      apiGet("/user/profile_info"),
    ]);
    return { content: [{ type: "text", text: JSON.stringify({ me, info }, null, 2) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
