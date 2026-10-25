"""
LBank API client (async, httpx)

Public market-data endpoints only — no API key required:
  - GET /v2/ticker/24hr.do   -> 24h ticker
  - GET /v2/kline.do         -> candlesticks (OHLCV)

Verified against the live API (2026-10):
  * kline.do REQUIRES the `time` parameter (anchor timestamp).
    We anchor at (now - limit * tf_seconds) so the last `limit` candles end at "now".
  * The real data array order is:  [time, OPEN, HIGH, LOW, CLOSE, volume]
    (Self-verified: consecutive closes match next opens, and candle low == 24h ticker low.)
"""

import time
from typing import Optional

import httpx

TF_SECONDS = {
    "minute1": 60,
    "minute5": 300,
    "minute15": 900,
    "minute30": 1800,
    "hour1": 3600,
    "hour4": 14400,
    "hour8": 28800,
    "day1": 86400,
    "week1": 604800,
}

BASE_URLS = ("https://api.lbkex.com", "https://api.lbank.info")


class LBankError(Exception):
    """Raised when LBank returns an error or an unusable response."""


class LBankClient:
    def __init__(self, timeout: float = 15.0):
        self._client = httpx.AsyncClient(timeout=timeout, headers={"User-Agent": "lbank-watchlist-bot/1.0"})

    async def close(self) -> None:
        await self._client.aclose()

    # ------------------------------------------------------------------ #
    async def _get(self, path: str, params: dict) -> dict:
        last_exc: Optional[Exception] = None
        for base in BASE_URLS:  # try fallback domain on network failure
            try:
                resp = await self._client.get(f"{base}{path}", params=params)
                resp.raise_for_status()
                data = resp.json()
                if data.get("error_code", 0) != 0:
                    raise LBankError(f"LBank error {data.get('error_code')}: {data.get('msg')}")
                return data
            except (httpx.HTTPError, ValueError) as exc:  # network / JSON issues
                last_exc = exc
                continue
        raise LBankError(f"Request to LBank failed: {last_exc}")

    # ------------------------------------------------------------------ #
    async def ticker(self, symbol: str) -> dict:
        """24h ticker for one pair. Returns dict with latest/change/high/low/vol."""
        data = await self._get("/v2/ticker/24hr.do", {"symbol": symbol})
        rows = (data.get("data") or [])
        if not rows:
            raise LBankError(f"Empty ticker for '{symbol}' (pair probably not listed)")
        t = rows[0].get("ticker", {})
        return {
            "symbol": rows[0].get("symbol", symbol),
            "latest": float(t.get("latest", 0)),
            "high": float(t.get("high", 0)),
            "low": float(t.get("low", 0)),
            "change": float(t.get("change", 0)),       # percent, e.g. -1.27
            "vol": float(t.get("vol", 0)),             # base-asset volume
            "turnover": float(t.get("turnover", 0)),   # quote-asset volume (USDT)
        }

    # ------------------------------------------------------------------ #
    async def klines(self, symbol: str, tf: str = "day1", limit: int = 200) -> list[dict]:
        """Candles for a pair. tf must be one of TF_SECONDS keys."""
        if tf not in TF_SECONDS:
            raise LBankError(f"Unsupported timeframe '{tf}'. Allowed: {', '.join(TF_SECONDS)}")
        params = {
            "symbol": symbol,
            "type": tf,
            "size": int(limit),
            "time": int(time.time()) - int(limit) * TF_SECONDS[tf],
        }
        data = await self._get("/v2/kline.do", params)
        rows = data.get("data") or []
        candles = []
        for r in rows:
            candles.append(
                {
                    "time": int(r[0]),
                    "open": float(r[1]),
                    "high": float(r[2]),
                    "low": float(r[3]),
                    "close": float(r[4]),
                    "volume": float(r[5]),
                }
            )
        return candles

    # ------------------------------------------------------------------ #
    async def validate_symbol(self, symbol: str) -> bool:
        try:
            await self.ticker(symbol)
            return True
        except LBankError:
            return False
