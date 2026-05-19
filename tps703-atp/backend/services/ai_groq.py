"""Phase 10 — AI helpers backed by Groq.

Groq's API is OpenAI-wire-compatible: we POST chat completions to
``https://api.groq.com/openai/v1/chat/completions`` with
``Authorization: Bearer $GROQ_API_KEY``. The four wave-5 features call
``chat_json`` which forces ``response_format = {"type": "json_object"}``
so the model returns parseable JSON we can hand straight to the database.

Without ``GROQ_API_KEY`` set, every helper raises ``GroqNotConfigured``
which the routers translate to ``503``. The rest of the system keeps
working — AI is an enhancement, not a hard dependency.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import random

import httpx


logger = logging.getLogger(__name__)


# Reasonable defaults. Override per-call if a feature needs something
# specific. Llama-3.3-70b on Groq is fast and good at structured JSON.
DEFAULT_MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
DEFAULT_BASE_URL = os.environ.get("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
DEFAULT_TIMEOUT = 60.0


class GroqNotConfigured(RuntimeError):
    """Raised when ``GROQ_API_KEY`` is not present in the environment."""


class GroqError(RuntimeError):
    """Wraps any non-2xx response from the Groq endpoint."""


def _api_key() -> str:
    key = os.environ.get("GROQ_API_KEY")
    if not key:
        raise GroqNotConfigured(
            "GROQ_API_KEY env var is unset. Set it in the backend's "
            "environment (or .env) to enable AI features."
        )
    return key


async def _post_with_retry(url: str, payload: dict, headers: dict) -> httpx.Response:
    """POST to Groq with bounded exponential backoff on 429 / 5xx.

    Groq's free tier rate-limits per minute. A handful of legitimate AI
    calls fired close together can transiently 429. We retry up to 4 times
    with jittered backoff (0.5, 1, 2, 4 seconds) before surfacing the
    error to the caller. On the final retry we honour the
    ``Retry-After`` header if present.
    """
    delays = [0.5, 1.0, 2.0, 4.0]
    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        for attempt, delay in enumerate(delays + [None]):
            resp = await client.post(url, json=payload, headers=headers)
            # Final attempt or success → return
            if delay is None or resp.status_code < 500 and resp.status_code != 429:
                return resp
            ra = resp.headers.get("retry-after")
            if ra:
                try:
                    delay = min(float(ra), 8.0)
                except ValueError:
                    pass
            # Add small jitter so concurrent callers don't synchronize
            sleep_for = delay + random.uniform(0, 0.25)
            logger.info(
                "Groq returned %s; retrying in %.2fs (attempt %d/%d)",
                resp.status_code, sleep_for, attempt + 1, len(delays),
            )
            await asyncio.sleep(sleep_for)
    return resp  # type: ignore[return-value]


async def chat_json(
    *,
    system: str,
    user: str,
    model: str | None = None,
    temperature: float = 0.2,
    max_tokens: int = 4000,
) -> dict:
    """Call Groq and parse the assistant's reply as a JSON object."""
    api_key = _api_key()
    payload = {
        "model": model or DEFAULT_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    url = f"{DEFAULT_BASE_URL}/chat/completions"

    resp = await _post_with_retry(url, payload, headers)
    if resp.status_code >= 400:
        raise GroqError(f"Groq HTTP {resp.status_code}: {resp.text[:500]}")

    body = resp.json()
    try:
        content = body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as e:
        raise GroqError(f"Groq response missing choices[0].message.content: {body}") from e

    try:
        return json.loads(content)
    except json.JSONDecodeError as e:
        raise GroqError(
            f"Groq did not return parseable JSON despite response_format. "
            f"First 400 chars: {content[:400]}"
        ) from e


async def chat_text(
    *,
    system: str,
    user: str,
    model: str | None = None,
    temperature: float = 0.2,
    max_tokens: int = 2000,
) -> str:
    """Call Groq for free-form prose (used by impact-summary)."""
    api_key = _api_key()
    payload = {
        "model": model or DEFAULT_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    url = f"{DEFAULT_BASE_URL}/chat/completions"
    resp = await _post_with_retry(url, payload, headers)
    if resp.status_code >= 400:
        raise GroqError(f"Groq HTTP {resp.status_code}: {resp.text[:500]}")
    body = resp.json()
    try:
        return body["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError) as e:
        raise GroqError(f"Groq response shape unexpected: {body}") from e
