"""Append what each model call cost to a JSONL file (used for spend per layer).

Active only when RC_COST_LOG is set. RC_COST_PROJECT / RC_COST_LAYER are set by
whoever starts the process; RC_COST_STAGE is kept up to date by the runner.
"""

from __future__ import annotations

import json
import os
import time
from typing import Any


def record(model: str, usage: Any) -> None:
    path = os.environ.get("RC_COST_LOG", "")
    if not path or not isinstance(usage, dict):
        return
    try:
        cost = usage.get("cost")
        line = json.dumps({
            "ts": round(time.time(), 1),
            "project": os.environ.get("RC_COST_PROJECT", ""),
            "layer": os.environ.get("RC_COST_LAYER", ""),
            "stage": int(os.environ.get("RC_COST_STAGE", "0") or 0),
            "model": model,
            "cost": float(cost) if cost is not None else None,
            "tokens_in": usage.get("prompt_tokens"),
            "tokens_out": usage.get("completion_tokens"),
        })
        with open(path, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:  # noqa: BLE001 — accounting must never break a run
        pass
