"""
Chat endpoint that streams Claude's response back to the browser. The model
has three categories of tools available:

  1. **App-data tools** (query_food_prices, query_food_balance,
     query_predictions, query_producer_prices, query_population) — pull rows
     from the app's Postgres so Claude can answer questions grounded in the
     same data the user is looking at on the page.

  2. **web_search** — Anthropic's server-side tool for current events, news,
     prices past 2023-07, policy updates, weather. Used selectively.

  3. **Direct response** — no tool, just a textual answer. For clarifying
     questions, methodology, or follow-ups that don't need new data.

Claude decides per-turn which mode to use based on the question. We run an
agentic loop here: stream until the model emits a tool_use, dispatch it via
`TOOL_HANDLERS`, append the result, stream again. Caps at MAX_TURNS to avoid
runaway loops.

Stream protocol (Server-Sent Events):
    data: {"type": "text", "text": "..."}              ← incremental text delta
    data: {"type": "tool_call", "name": "<tool>"}      ← model invoked a tool
    data: {"type": "tool_result", "name": "<tool>",
           "count": <int>}                             ← tool returned N rows
    data: {"type": "done"}                             ← end of stream
    data: {"type": "error", "error": "..."}            ← any failure
"""

from __future__ import annotations

import asyncio
import json
from typing import Literal

from anthropic import AsyncAnthropic, APIConnectionError, APIStatusError
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.core.config import get_settings
from app.services.chat_tools import TOOL_HANDLERS

router = APIRouter()

# Transient HTTP statuses we retry. 429 = rate-limited, 503 = service
# unavailable, 529 = Anthropic-specific "overloaded".
RETRY_STATUS_CODES = (429, 503, 529)
MAX_RETRIES = 2
BASE_BACKOFF_S = 4


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    crop: str
    messages: list[ChatMessage]
    # Whether to expose the web_search tool. Defaults to True so the chat can
    # answer current-events questions; users can disable for a faster reply
    # that's restricted to app data + general knowledge.
    web_search: bool = True
    # Optional Ghana region scope (e.g. "Ashanti"). When set, the system
    # prompt narrows analysis to that region.
    region: str | None = None


# ── Custom tool schemas (data lookups) ──────────────────────────────────────
# Claude needs the description + JSON schema; the actual implementation lives
# in app/services/chat_tools.py. Names must match TOOL_HANDLERS keys.
APP_DATA_TOOLS = [
    {
        "name": "query_food_prices",
        "description": (
            "Get WFP-reported retail/wholesale food prices for Ghana from "
            "the app's database. Use for historical price questions about a "
            "specific commodity, optionally filtered by market and date "
            "range. Coverage: 2006-01 through 2023-07. For prices after "
            "2023-07, use web_search instead."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "commodity": {"type": "string", "description": "Commodity name, e.g. 'Maize', 'Rice', 'Cassava'."},
                "market": {"type": "string", "description": "Optional market name, e.g. 'Accra', 'Tamale'."},
                "date_from": {"type": "string", "description": "Optional ISO date YYYY-MM-DD."},
                "date_to": {"type": "string", "description": "Optional ISO date YYYY-MM-DD."},
                "limit": {"type": "integer", "description": "Max rows (1-200, default 50)."},
            },
            "required": ["commodity"],
        },
    },
    {
        "name": "query_food_balance",
        "description": (
            "FAO Food Balance Sheet rows for a Ghana crop. Returns Production, "
            "Food, Feed, Losses, Imports, Exports, Domestic supply, Stock "
            "Variation, etc. Values are in 1000 tonnes (multiply by 1000 for "
            "tonnes). Use for supply/demand/trade questions, surplus or "
            "deficit calculations."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "crop": {"type": "string", "description": "Crop name, e.g. 'Maize', 'Rice'."},
                "year_min": {"type": "integer", "description": "Optional inclusive lower bound."},
                "year_max": {"type": "integer", "description": "Optional inclusive upper bound."},
                "elements": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional list of FAO elements, e.g. ['Production', 'Food', 'Imports'].",
                },
            },
            "required": ["crop"],
        },
    },
    {
        "name": "query_predictions",
        "description": (
            "Maize yield/area/production predictions from one of three models: "
            "'tabpfn' (foundation tabular model), 'lightgbm' (GBM on climate "
            "features), 'rolling' (5-year mean baseline). Each row has "
            "actuals (when source='backtest') and model predictions. Future "
            "rows (source='future_*') have only predictions."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "model": {"type": "string", "enum": ["tabpfn", "lightgbm", "rolling"]},
                "region": {"type": "string", "description": "Optional Ghana region."},
                "year_min": {"type": "integer"},
                "year_max": {"type": "integer"},
                "source": {"type": "string", "description": "Optional 'backtest' or 'future_*'."},
            },
            "required": ["model"],
        },
    },
    {
        "name": "query_producer_prices",
        "description": (
            "FAO producer prices for a Ghana crop. Multiple Element variants "
            "exist: 'Producer Price (LCU/tonne)' for Ghana cedi, "
            "'Producer Price (USD/tonne)', and 'Producer Price Index "
            "(2014-2016 = 100)'. Use for farmgate-vs-retail spread analysis "
            "or producer-price trend questions."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "item": {"type": "string", "description": "Crop / item name, e.g. 'Maize'."},
                "year_min": {"type": "integer"},
                "year_max": {"type": "integer"},
                "element": {"type": "string", "description": "Optional substring filter, e.g. 'LCU/tonne'."},
            },
            "required": ["item"],
        },
    },
    {
        "name": "query_population",
        "description": (
            "Ghana population by year. Includes FAO/UN projections through "
            "2100. Values are in 1000 No (thousands of people)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "year_min": {"type": "integer"},
                "year_max": {"type": "integer"},
                "element": {"type": "string", "description": "Default 'Total Population - Both sexes'."},
            },
        },
    },
]

WEB_SEARCH_TOOL = {
    "type": "web_search_20250305",
    "name": "web_search",
    "max_uses": 5,
}


# Hard cap on agentic turns. Each turn is one stream → optional tool exec →
# stream again. Most queries finish in 1-2 turns; cap defends against loops.
MAX_TURNS = 6


SYSTEM_PROMPT = """You are an agricultural-market analyst helping users \
understand Ghana food market data. The user is currently looking at the \
crop: **{crop}**{region_clause}.

You have three categories of capabilities — pick the right one per question:

1. **App-data tools** — query_food_prices, query_food_balance, \
query_predictions, query_producer_prices, query_population. These read \
directly from the app's Postgres (the same data the charts on the page \
use). Prefer them for historical/quantitative questions where the answer \
lives in the database. They're fast, deterministic, and cite-able.

2. **web_search** — for things outside the database: today's prices, news \
since 2023-07, policy announcements, weather events, regional dynamics not \
captured in FAO/MoFA. Cross-check across multiple credible sources before \
answering.

3. **Direct response (no tool)** — for clarifying questions, methodology \
explanations, conceptual answers, or follow-ups that don't require new data. \
Don't call a tool just to call one.

Decision examples:
- "What was Ghana's maize production in 2020?" → query_food_balance \
(crop='Maize', year_min=2020, year_max=2020).
- "Latest maize price in Tamale?" → query_food_prices first (returns up to \
mid-2023), then web_search if the user wants today's price.
- "How does the LightGBM model compare to TabPFN?" → query_predictions for \
both, compare backtest accuracy.
- "Explain what 'food surplus' means here." → direct response.
- "Any recent fertilizer subsidy changes?" → web_search.
- "Why is the supply line dropping in 2014?" → query_food_balance to inspect \
the 2014 row, then explain.

Focus on this crop{region_focus} unless the user pivots.

Source-quality rules (apply to BOTH tool results and web search):
- Cross-check across **multiple credible sources** for any non-trivial fact.
- **Credible sources**: official statistics agencies (FAOSTAT, GSS, MoFA \
SRID, Bank of Ghana, NAFCO, WFP, World Bank, IMF, AfDB), peer-reviewed \
research, intergovernmental publications (FAO GIEWS, USDA FAS, ECOWAS), \
and established news outlets (Reuters, AP, Bloomberg, BBC, AFP, FT, WSJ, \
GhanaWeb, MyJoyOnline, Citi Newsroom, Graphic Online, Africa News, \
Quartz Africa).
- **Avoid**: forums, social-media posts, blogs without bylines, content \
farms, unverified aggregators, sources you can't identify.
- If sources disagree, state the range — don't pick one silently.
- If you can't verify a numeric claim with at least two sources, flag it \
as preliminary or unverified.

Citation rules:
- Cite each fact inline with the source. App-data results: cite as \
"(app DB, FAO Food Balance / WFP HDEX, year)". Web sources: cite \
"(Publisher, date)".
- Prefer the original primary source over a secondary aggregator.

Be concise and direct. Bullet lists for multi-part answers; short \
paragraphs otherwise.

Formatting rules:
- Do **not** use emojis anywhere in your response — not in headings, \
bullets, status indicators, or inline. Plain text only."""


@router.post("/chat")
async def chat(req: ChatRequest):
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY not configured. Set it in .env to enable the chat panel.",
        )

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)

    # Combine app-data tools with web_search (optional). Claude picks per
    # turn based on the system prompt's guidance.
    tools = list(APP_DATA_TOOLS)
    if req.web_search:
        tools.append(WEB_SEARCH_TOOL)

    system_prompt = SYSTEM_PROMPT.format(
        crop=req.crop,
        region_clause=f" in **{req.region}** region" if req.region else "",
        region_focus=f" within {req.region}" if req.region else "",
    )

    # Mutable conversation buffer — we append assistant + tool_result blocks
    # as the agentic loop progresses. Convert Pydantic models to dicts up
    # front so they're consistent with the tool-result blocks we'll add later.
    messages: list[dict] = [{"role": m.role, "content": m.content} for m in req.messages]

    async def event_stream():
        try:
            for _ in range(MAX_TURNS):
                # Retry the stream attempt on transient errors (Anthropic
                # overload, rate limit, brief outage). Exponential backoff
                # with a `retry` SSE event between attempts so the frontend
                # can surface it as a chat step. Overload errors almost
                # always occur at request-creation time (before any tokens
                # flow), so re-running the attempt cleanly redoes the turn.
                final = None
                for attempt in range(MAX_RETRIES + 1):
                    try:
                        async with client.messages.stream(
                            model="claude-sonnet-4-6",
                            max_tokens=2048,
                            system=system_prompt,
                            messages=messages,
                            tools=tools,
                        ) as stream:
                            async for text in stream.text_stream:
                                yield f"data: {json.dumps({'type': 'text', 'text': text})}\n\n"
                            final = await stream.get_final_message()
                        break  # success — exit retry loop, continue to tool dispatch
                    except APIStatusError as e:
                        transient = e.status_code in RETRY_STATUS_CODES
                        if transient and attempt < MAX_RETRIES:
                            wait_s = BASE_BACKOFF_S * (2 ** attempt)  # 4s, 8s
                            yield f"data: {json.dumps({'type': 'retry', 'after_seconds': wait_s, 'reason': 'overloaded' if e.status_code == 529 else 'rate_limit'})}\n\n"
                            await asyncio.sleep(wait_s)
                            continue
                        raise
                    except APIConnectionError:
                        if attempt < MAX_RETRIES:
                            wait_s = BASE_BACKOFF_S * (2 ** attempt)
                            yield f"data: {json.dumps({'type': 'retry', 'after_seconds': wait_s, 'reason': 'connection'})}\n\n"
                            await asyncio.sleep(wait_s)
                            continue
                        raise

                # Defensive: if the retry loop somehow exits without setting
                # `final` (shouldn't be reachable given the break/raise paths
                # above), surface as a hard error rather than dereferencing None.
                if final is None:
                    yield f"data: {json.dumps({'type': 'error', 'error': 'No response from model after retries.'})}\n\n"
                    return

                # If the model finished without calling a tool, we're done.
                if final.stop_reason != "tool_use":
                    yield f"data: {json.dumps({'type': 'done'})}\n\n"
                    return

                # Execute every tool_use block in this turn (the model may
                # request more than one in parallel).
                tool_results: list[dict] = []
                for block in final.content:
                    if block.type != "tool_use":
                        continue

                    name = block.name
                    inputs = block.input or {}

                    # Server-side `web_search` is executed by Anthropic, not
                    # us — its result is already in `final.content` as a
                    # `web_search_tool_result` block. We don't dispatch it.
                    handler = TOOL_HANDLERS.get(name)
                    if handler is None:
                        continue

                    yield f"data: {json.dumps({'type': 'tool_call', 'name': name})}\n\n"
                    try:
                        result = await handler(**inputs)
                    except TypeError as e:
                        # Bad argument shape — surface as a tool error so the
                        # model can self-correct, but don't crash the stream.
                        result = {"error": f"invalid arguments: {e}"}
                    except Exception as e:  # noqa: BLE001 — we want any DB or runtime issue captured
                        result = {"error": f"{type(e).__name__}: {e}"}

                    yield f"data: {json.dumps({'type': 'tool_result', 'name': name, 'count': result.get('count')})}\n\n"
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": json.dumps(result, default=str),
                    })

                # If the only tool_use blocks were server-side (web_search),
                # there's nothing for us to feed back — Anthropic handled it
                # and the stream's already advanced past tool_use. Break to
                # avoid an empty-results loop.
                if not tool_results:
                    yield f"data: {json.dumps({'type': 'done'})}\n\n"
                    return

                # Append the model's tool-using assistant turn + our tool
                # results, then loop for another generation pass.
                messages.append({"role": "assistant", "content": final.content})
                messages.append({"role": "user", "content": tool_results})

            # Hit MAX_TURNS without natural stop — surface so users know.
            yield f"data: {json.dumps({'type': 'error', 'error': 'max tool-use turns reached'})}\n\n"

        except APIStatusError as e:
            # Friendly mapping for known status codes. The raw error object
            # is logged server-side via the request_id; the user sees a
            # human-readable message.
            if e.status_code == 529:
                msg = "Anthropic is currently overloaded. Please try again in a moment."
            elif e.status_code == 429:
                msg = "Rate limit reached. Please wait a moment and try again."
            elif 500 <= e.status_code < 600:
                msg = "Anthropic returned a temporary error. Please try again."
            else:
                msg = f"Anthropic API error ({e.status_code}). Please try again."
            print(f"chat: APIStatusError {e.status_code} request_id={getattr(e, 'request_id', None)}")
            yield f"data: {json.dumps({'type': 'error', 'error': msg})}\n\n"
        except APIConnectionError:
            yield f"data: {json.dumps({'type': 'error', 'error': 'Could not reach Anthropic. Check your connection and try again.'})}\n\n"
        except Exception as e:  # noqa: BLE001
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
