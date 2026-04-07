#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import os from "os";
import path from "path";

const API_HOST = process.env.GT_API_URL || "http://46.225.216.13:8765";
const BASE_URL = `${API_HOST}/api/v1`;
const AUTH_BASE = API_HOST;
const AUTH_FILE = path.join(os.homedir(), ".gt-mcp-auth.json");

// ─── Token storage ───────────────────────────────────────────────────────────
// Priority: env vars → ~/.gt-mcp-auth.json → unauthenticated
function loadSavedTokens() {
  try {
    const raw = fs.readFileSync(AUTH_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const saved = loadSavedTokens();
let currentToken = process.env.GT_TOKEN || saved.access_token || null;
let currentRefreshToken = process.env.GT_REFRESH_TOKEN || saved.refresh_token || null;

function persistTokens(access, refresh) {
  currentToken = access;
  if (refresh) currentRefreshToken = refresh;
  try {
    fs.writeFileSync(
      AUTH_FILE,
      JSON.stringify({ access_token: access, refresh_token: refresh ?? currentRefreshToken }, null, 2)
    );
  } catch {
    // non-fatal — in-memory tokens still work for this session
  }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function jwtExp(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    return payload.exp ?? 0;
  } catch {
    return 0;
  }
}

async function ensureFreshToken() {
  if (!currentToken) {
    throw new Error(
      "Not authenticated. Call the 'authenticate' tool with your GT Protocol email and password first."
    );
  }
  const now = Math.floor(Date.now() / 1000);
  if (jwtExp(currentToken) > now + 300) return; // token valid for 5+ min, use as-is

  // Access token expired or expiring soon — refresh proactively
  if (!currentRefreshToken) {
    throw new Error(
      "Session expired and no refresh token available. Call 'authenticate' with your email and password."
    );
  }
  const res = await fetch(`${AUTH_BASE}/auth/refresh`, {
    method: "POST",
    headers: { Authorization: `Bearer ${currentRefreshToken}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(
      "Session expired. Call the 'authenticate' tool with your GT Protocol email and password."
    );
  }
  const body = await res.json();
  const data = body.data ?? body;
  const newAccess = data.access_token ?? data.token;
  if (!newAccess) throw new Error("Token refresh succeeded but response contains no access_token.");
  persistTokens(newAccess, data.refresh_token ?? null);
}

function authHeaders() {
  return { Authorization: `Bearer ${currentToken}`, "Content-Type": "application/json" };
}

async function request(method, path, body) {
  await ensureFreshToken(); // proactive check — never send an expired token
  const opts = { method, headers: authHeaders() };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json();
}

const apiGet   = (path)       => request("GET",   path);
const apiPost  = (path, body) => request("POST",  path, body ?? {});
const apiPatch = (path, body) => request("PATCH", path, body ?? {});

// ─── MCP Server ───────────────────────────────────────────────────────────────
const server = new McpServer({ name: "gt-protocol", version: "2.0.0" });

// ── Auth ──────────────────────────────────────────────────────────────────────

server.tool(
  "authenticate",
  "Authenticate with your GT Protocol account. Call this once to connect the MCP server. " +
    "Tokens are saved to ~/.gt-mcp-auth.json and auto-refreshed — no need to call this again unless your session is fully expired.",
  {
    email: z.string().describe("GT Protocol account email"),
    password: z.string().describe("GT Protocol account password"),
  },
  async ({ email, password }) => {
    const res = await fetch(`${AUTH_BASE}/auth/sign_in`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(`Authentication failed: ${body.message || JSON.stringify(body)}`);
    }
    const data = body.data ?? body;
    const access = data.access_token ?? data.token;
    const refresh = data.refresh_token;
    if (!access) throw new Error("No access_token in response. Check your credentials.");
    persistTokens(access, refresh);
    // Verify by fetching profile
    const me = await apiGet("/user/me");
    const meData = me.data ?? me;
    const userEmail = meData.email ?? email;
    return {
      content: [
        {
          type: "text",
          text: `Authenticated as ${userEmail}. All GT Protocol tools are now available.\nTokens saved to ${AUTH_FILE} — auto-refreshed on next use.`,
        },
      ],
    };
  }
);

// ── Bots ──────────────────────────────────────────────────────────────────────

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

server.tool(
  "get_bot",
  "Get details of a specific strategy/bot by ID.",
  { bot_id: z.number().describe("Bot ID") },
  async ({ bot_id }) => {
    const data = await apiGet(`/bot/${bot_id}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "start_bot",
  "Activate (start) a strategy/bot. The bot will start looking for entry signals and opening deals.",
  { bot_id: z.number().describe("Bot ID") },
  async ({ bot_id }) => {
    const data = await apiPost(`/bot/${bot_id}/start`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "stop_bot",
  "Deactivate (stop) a strategy/bot. The bot stops opening new deals but keeps existing ones open.",
  { bot_id: z.number().describe("Bot ID") },
  async ({ bot_id }) => {
    const data = await apiPost(`/bot/${bot_id}/stop`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "paper_clone",
  "Create a paper trading (demo) copy of an existing live bot. " +
    "Note: requires the bot to be active on a connected real exchange. Returns 404 if conditions are not met.",
  { bot_id: z.number().describe("Bot ID to clone as paper/demo bot") },
  async ({ bot_id }) => {
    const data = await apiPost(`/bot/${bot_id}/paper_clone`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ── Deals ─────────────────────────────────────────────────────────────────────

server.tool(
  "start_deal",
  "Manually start a deal on an active bot immediately, without waiting for a signal. " +
    "The bot must be in active (started) state.",
  { bot_id: z.number().describe("Bot ID") },
  async ({ bot_id }) => {
    const data = await apiPost(`/bot/deal/${bot_id}/start`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "close_deal",
  "Close the active deal on a bot at market price. Works for both SPOT and FUTURES bots.",
  { bot_id: z.number().describe("Bot ID whose active deal should be closed") },
  async ({ bot_id }) => {
    const data = await apiPost(`/bot/deal/${bot_id}/close`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "list_deals",
  "List all deals (open and closed) with optional filters.",
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

server.tool(
  "get_active_deals",
  "Get all currently active (open) deals.",
  {},
  async () => {
    const data = await apiGet("/user/deals/active");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_deal_history",
  "Get closed deal history with profit/loss.",
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

// ── Exchange ──────────────────────────────────────────────────────────────────

server.tool(
  "get_exchanges",
  "List connected exchange accounts.",
  {},
  async () => {
    const data = await apiGet("/exchange");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_balance",
  "Get balance for a specific exchange account.",
  { user_exchange_id: z.number().describe("User exchange account ID (from get_exchanges)") },
  async ({ user_exchange_id }) => {
    const data = await apiGet(`/exchange/balance/${user_exchange_id}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ── User ──────────────────────────────────────────────────────────────────────

server.tool(
  "get_profile",
  "Get current user profile, stats, and membership info.",
  {},
  async () => {
    const [me, info] = await Promise.all([apiGet("/user/me"), apiGet("/user/profile_info")]);
    return { content: [{ type: "text", text: JSON.stringify({ me, info }, null, 2) }] };
  }
);


// ─────────────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
