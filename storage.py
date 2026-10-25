"""
Tiny JSON persistence for watchlist / cooldowns / settings.

⚠️ Railway note: the filesystem is EPHEMERAL (wiped on every redeploy/restart).
   To keep the watchlist persistent, attach a Railway Volume mounted at /data
   (the bot auto-uses /data if the directory exists, otherwise ./data).
"""

import json
import os
import threading
import time


class Storage:
    def __init__(self, data_dir: str, defaults: dict):
        self._lock = threading.Lock()
        self._path = os.path.join(data_dir, "state.json")
        os.makedirs(data_dir, exist_ok=True)
        self._defaults = defaults
        self._state = dict(defaults)
        self._load()

    # ---------------- io ---------------- #
    def _load(self) -> None:
        try:
            with open(self._path, "r", encoding="utf-8") as f:
                stored = json.load(f)
            self._state = {**self._defaults, **stored}
        except (FileNotFoundError, json.JSONDecodeError):
            self._state = dict(self._defaults)
            self._save()

    def _save(self) -> None:
        tmp = self._path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self._state, f, ensure_ascii=False, indent=2)
        os.replace(tmp, self._path)

    def _mutate(self, fn) -> None:
        with self._lock:
            fn(self._state)
            self._save()

    # ---------------- watchlist ---------------- #
    @property
    def watchlist(self) -> list[str]:
        return list(self._state.get("watchlist", []))

    def add_symbol(self, symbol: str) -> bool:
        changed = False

        def fn(s):
            nonlocal changed
            wl = s.setdefault("watchlist", [])
            if symbol not in wl:
                wl.append(symbol)
                changed = True

        self._mutate(fn)
        return changed

    def remove_symbol(self, symbol: str) -> bool:
        changed = False

        def fn(s):
            nonlocal changed
            wl = s.setdefault("watchlist", [])
            if symbol in wl:
                wl.remove(symbol)
                changed = True

        self._mutate(fn)
        return changed

    # ---------------- alert target ---------------- #
    @property
    def alert_chat_id(self):
        return self._state.get("alert_chat_id")

    def set_alert_chat(self, chat_id) -> None:
        def fn(s):
            s["alert_chat_id"] = chat_id

        self._mutate(fn)

    # ---------------- interval / timeframe ---------------- #
    @property
    def interval_min(self) -> int:
        return int(self._state.get("interval_min", 60))

    def set_interval(self, minutes: int) -> None:
        def fn(s):
            s["interval_min"] = minutes

        self._mutate(fn)

    @property
    def timeframe(self) -> str:
        return self._state.get("timeframe", "day1")

    def set_timeframe(self, tf: str) -> None:
        def fn(s):
            s["timeframe"] = tf

        self._mutate(fn)

    # ---------------- cooldown ---------------- #
    def _cooldowns(self) -> dict:
        return self._state.setdefault("cooldowns", {})

    def on_cooldown(self, symbol: str, sig_key: str, hours: float) -> bool:
        entry = self._cooldowns().get(f"{symbol}|{sig_key}")
        if entry is None:
            return False
        return (time.time() - entry) < hours * 3600

    def mark_signal(self, symbol: str, sig_key: str) -> None:
        def fn(s):
            cd = s.setdefault("cooldowns", {})
            cd[f"{symbol}|{sig_key}"] = time.time()
            # prune entries older than 7 days
            cutoff = time.time() - 7 * 86400
            for k in [k for k, v in cd.items() if v < cutoff]:
                del cd[k]

        self._mutate(fn)
