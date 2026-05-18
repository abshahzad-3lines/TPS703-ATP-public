"""In-process sliding-window rate limiter for AI endpoints.

Why this exists: AI endpoints call Groq, which has free-tier per-minute and
per-day limits. A bug or hostile user could loop through those and either
(a) hit Groq's hard cap and break the feature for everyone, or (b) if the
account ever moves to a paid tier, generate real charges. This limiter
caps each authenticated user to ``MAX_PER_MINUTE`` and ``MAX_PER_DAY``
calls across all four AI endpoints combined.

The state lives in process memory — fine for the single-instance Render
free tier. If/when this moves to multi-instance, swap for Redis (e.g.
Upstash) with the same interface.
"""

from __future__ import annotations

import time
from collections import deque
from threading import Lock

from fastapi import HTTPException, status

from auth.models import UserInDB


MAX_PER_MINUTE = 20
MAX_PER_DAY = 200


_buckets: dict[int, deque[float]] = {}
_lock = Lock()


def check_and_record(user: UserInDB) -> None:
    """Raise 429 if the user is over budget; otherwise record the call.

    Sliding window: we keep a deque of call timestamps per user and trim
    entries older than 24 h on every check. O(1) amortized.
    """
    now = time.time()
    minute_ago = now - 60
    day_ago = now - 86_400

    with _lock:
        bucket = _buckets.setdefault(user.id, deque())
        # Trim anything older than 24 h
        while bucket and bucket[0] < day_ago:
            bucket.popleft()

        # Count last 60 s
        in_last_minute = sum(1 for t in bucket if t >= minute_ago)
        if in_last_minute >= MAX_PER_MINUTE:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=(
                    f"AI rate limit: {MAX_PER_MINUTE}/min. "
                    f"Try again in 60s."
                ),
            )

        if len(bucket) >= MAX_PER_DAY:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=(
                    f"AI rate limit: {MAX_PER_DAY}/day. "
                    f"Resets 24 h after your first call today."
                ),
            )

        bucket.append(now)


def usage(user: UserInDB) -> dict:
    """Return current usage counts for a user — for debugging / UI display."""
    now = time.time()
    with _lock:
        bucket = _buckets.get(user.id, deque())
        return {
            "in_last_minute": sum(1 for t in bucket if t >= now - 60),
            "in_last_day": sum(1 for t in bucket if t >= now - 86_400),
            "max_per_minute": MAX_PER_MINUTE,
            "max_per_day": MAX_PER_DAY,
        }
