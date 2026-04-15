"""
Backtest proxy — forwards POST /backtest to backtest.gt-protocol.io.

Endpoints:
  GET  /proxy-key  — validates GT Protocol Bearer token, returns static proxy key
  POST /backtest   — proxies backtest request (requires X-Api-Key)
"""
import json
import logging
import os
from datetime import datetime, timedelta, timezone

AUTH_LOG = os.getenv("AUTH_LOG_FILE", "/opt/gt-bot-new/auth-log.jsonl")

import httpx
from aiohttp import web
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("PROXY_API_KEY", "")
PORT = int(os.getenv("PROXY_PORT", "8081"))
GT_API = os.getenv("GT_API_BASE", "http://46.225.216.13:8765")
BACKTEST_URL = "https://backtest.gt-protocol.io/api/backtest"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s proxy %(levelname)s %(message)s",
)
log = logging.getLogger(__name__)


async def handle_proxy_key(request: web.Request) -> web.Response:
    """Validate GT Protocol token → return static proxy key."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return web.Response(status=401, text="Missing Bearer token")

    gt_token = auth[7:]
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{GT_API}/api/v1/user/me",
                headers={"Authorization": f"Bearer {gt_token}"},
            )
        if resp.status_code != 200:
            log.warning("proxy-key: invalid GT token from %s (status %s)", request.remote, resp.status_code)
            return web.Response(status=401, text="Invalid GT Protocol token")
    except Exception as e:
        log.error("proxy-key: GT API error: %s", e)
        return web.Response(status=502, text=f"GT API error: {e}")

    user = resp.json().get("data", resp.json())
    email = user.get("email", request.remote)
    log.info("proxy-key issued to %s", email)
    with open(AUTH_LOG, "a") as f:
        entry = {"ts": datetime.now(timezone.utc).isoformat(), "email": email, "ip": request.remote}
        f.write(json.dumps(entry) + "\n")
    return web.Response(
        status=200,
        content_type="application/json",
        text=json.dumps({"proxy_key": API_KEY}),
    )


async def handle_backtest(request: web.Request) -> web.Response:
    """Forward backtest request to GT backtest service."""
    key = request.headers.get("X-Api-Key", "")
    if not API_KEY or key != API_KEY:
        log.warning("Unauthorized backtest request from %s", request.remote)
        return web.Response(status=401, text="Unauthorized")

    try:
        body = await request.json()
    except Exception:
        return web.Response(status=400, text="Invalid JSON body")

    # Auto-inject dates if missing
    if "start_date" not in body or "end_date" not in body:
        now = datetime.now(timezone.utc)
        body.setdefault("end_date", now.strftime("%Y-%m-%d"))
        body.setdefault("start_date", (now - timedelta(days=30)).strftime("%Y-%m-%d"))

    log.info(
        "Backtest request: %s %s %s %s→%s",
        body.get("symbol"), body.get("strategy"), body.get("timeframe"),
        body.get("start_date"), body.get("end_date"),
    )

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(BACKTEST_URL, json=body)
            if resp.status_code != 200:
                log.error("Backtest API %s: %s", resp.status_code, resp.text[:200])
                return web.Response(
                    status=502,
                    content_type="application/json",
                    text=json.dumps({"error": f"Backtest API {resp.status_code}", "detail": resp.text}),
                )
            data = resp.json()
        m = data.get("metrics", {})
        log.info(
            "Backtest OK: %s trades, win_rate=%.1f%%, pnl=%.2f%%",
            m.get("total_trades", "?"), m.get("win_rate", 0), m.get("net_pnl_percent", 0),
        )
        return web.Response(
            status=200,
            content_type="application/json",
            text=json.dumps(data),
        )
    except Exception as e:
        log.error("Proxy error: %s", e)
        return web.Response(status=502, text=f"Proxy error: {e}")


app = web.Application()
app.router.add_get("/proxy-key", handle_proxy_key)
app.router.add_post("/backtest", handle_backtest)

if __name__ == "__main__":
    log.info("Starting backtest proxy on port %s", PORT)
    web.run_app(app, host="0.0.0.0", port=PORT)
