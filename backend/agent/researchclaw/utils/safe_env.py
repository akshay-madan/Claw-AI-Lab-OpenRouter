"""Environment for running model-written code: everything except secrets.

Experiments, agent shell commands, plotting scripts and LaTeX are written by a
model. They must not inherit the API keys this process needs for its own calls.

This removes keys from the *environment* only. Code running as the same user can
still read files the user can read, so it is not a sandbox.
"""

from __future__ import annotations

import os
import re
from collections.abc import Iterable, Mapping

# Whole words between underscores, so KEYBOARD or TOKENIZERS_PARALLELISM survive
_SECRET_NAME = re.compile(
    r"(^|_)(API_?KEYS?|KEYS?|TOKENS?|SECRETS?|PASSWORDS?|PASSWD|PASSPHRASE|CREDENTIALS?|AUTH)(_|$)",
    re.IGNORECASE,
)
# Values that look like keys, whatever the variable is called
_SECRET_VALUE = re.compile(r"^(sk-|sk_|ghp_|gho_|github_pat_|hf_|AIza|xox[abp]-|tvly-|AKIA)[A-Za-z0-9_\-]{8,}")
_ALWAYS_DROP = ("CLAW_SECRETS_FILE", "SECRETS_FILE", "SSH_AUTH_SOCK")


def clean_env(
    extra: Mapping[str, str] | None = None,
    *,
    keep: Iterable[str] = (),
    base: Mapping[str, str] | None = None,
) -> dict[str, str]:
    """Copy of the environment without secrets.

    Dropped: variables with a secret-looking name or value, and any variable that
    contains the value of a dropped one (the same key under another name).
    `keep` lists names to leave in; `extra` is added last.
    """
    source = dict(os.environ if base is None else base)
    kept = {k for k in keep if k}
    dropped = {
        k for k, v in source.items()
        if k not in kept
        and (k in _ALWAYS_DROP or _SECRET_NAME.search(k) or _SECRET_VALUE.match(v or ""))
    }
    values = {
        source[k] for k in dropped
        if k not in _ALWAYS_DROP and len(source[k]) >= 12
    }
    env = {
        k: v for k, v in source.items()
        if k not in dropped and (k in kept or not any(s in v for s in values))
    }
    env.update(extra or {})
    return env
