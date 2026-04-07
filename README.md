# @gt-protocol/mcp

GT Protocol MCP Server — connect Claude, Cursor, Claude Code, or any MCP-compatible AI agent to your GT Protocol trading account.

Manage bots, run backtests, check balances, and automate trading strategies — all through natural language.

## What is MCP?

[Model Context Protocol](https://modelcontextprotocol.io) is an open standard that lets AI agents call external tools. This server exposes the GT Protocol REST API as a set of tools that any MCP-compatible AI can use.

## Quickstart

### 1. Get your tokens

```bash
node get-token.js your@email.com yourpassword
```

This prints your `GT_TOKEN` and `GT_REFRESH_TOKEN`. The access token expires in ~1 hour; the refresh token lasts 7 days. The server refreshes automatically — you only need to re-run this when the refresh token expires.

### 2. Add to Claude Code

Add this to your `.mcp.json` (or `~/.claude.json` for global access):

```json
{
  "mcpServers": {
    "gt-protocol": {
      "command": "node",
      "args": ["/path/to/gt-protocol/mcp-server/index.js"],
      "env": {
        "GT_TOKEN": "your_access_token",
        "GT_REFRESH_TOKEN": "your_refresh_token"
      }
    }
  }
}
```

### 3. Add to Cursor

Open **Settings → MCP** and add the same configuration block.

### 4. Start trading with AI

```
List my active bots
What's my Binance balance?
Create a BTC/USDT long bot with $50 start order and 2% take profit
Close the deal on bot 12345
Run a backtest for ETH/USDT with MACD strategy, 3% TP, 1% SL
```

---

## Available Tools

### Bots

| Tool | Description |
|------|-------------|
| `list_bots` | List all your strategies |
| `get_bot` | Get details of a specific bot |
| `create_bot` | Create a new trading bot |
| `update_bot` | Update bot settings |
| `start_bot` | Activate a bot |
| `stop_bot` | Deactivate a bot |
| `paper_clone` | Create a paper trading copy of a live bot |

### Deals

| Tool | Description |
|------|-------------|
| `list_deals` | List all deals (open + closed), filter by bot |
| `get_active_deals` | Get all currently active deals |
| `get_deal_history` | Closed deals with profit stats |
| `close_deal` | Market-close the active deal on a bot |

### Account

| Tool | Description |
|------|-------------|
| `get_exchanges` | List connected exchange accounts |
| `get_balance` | Get balance for an exchange account |
| `get_profile` | Current user profile and stats |

---

## Examples

### Morning portfolio check

```
What's the status of all my bots? Which ones have active deals?
Show me my total profit this week.
What's my available USDT balance on Binance?
```

### Strategy research

```
Run a backtest for BTC/USDT on Binance with bollinger strategy,
long direction, 2.5% TP, 1% SL, 5m timeframe, last 30 days.
Compare with MACD strategy same params.
```

### Bot management

```
Stop all my losing bots (those with negative total profit).
Clone my best-performing bot as a paper trade to test new settings.
Update bot 12345 — increase take profit to 3% and add a 5% stop loss.
```

---

## Paper Trading

GT Protocol supports paper (demo) trading — test strategies without real capital.

- Set `paper: true` in `create_bot` to create a demo bot from scratch
- Use `paper_clone` to copy an existing live bot into demo mode

Paper bots run on real market data but don't place real orders.

---

## Authentication Notes

- Tokens are JWT-based, issued per user session
- Access token: ~1 hour TTL
- Refresh token: ~7 days TTL
- The server auto-refreshes on 401 responses — no manual intervention needed
- Run `get-token.js` again when your refresh token expires (~weekly)

---

## Supported Exchanges

- **Binance** (SPOT + FUTURES)
- **Hyperliquid** (FUTURES)

---

## Requirements

- Node.js 18+
- A GT Protocol account — [sign up at gt-protocol.io](https://gt-protocol.io)
- A connected exchange account (Binance or Hyperliquid)

---

## License

MIT — free to use, fork, and extend.

Built by [GT Protocol](https://gt-protocol.io).
