"""
Chat endpoint that streams Claude's response back to the browser, with the
Anthropic web-search server tool enabled so answers are grounded in current
data instead of training-cutoff knowledge.

Usage from the frontend: POST /api/v1/chat with
    { "crop": "Maize", "messages": [{"role": "user", "content": "..."}] }

Streams Server-Sent Events:
    data: {"type": "text", "text": "..."}    ← incremental text delta
    data: {"type": "done"}                   ← end of stream
    data: {"type": "error", "error": "..."}  ← any failure
"""

from __future__ import annotations

import json
from typing import Literal

from anthropic import AsyncAnthropic
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.core.config import get_settings

router = APIRouter()


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    crop: str
    messages: list[ChatMessage]
    # Toggle for the web_search server tool. Defaults to True so the chat
    # is data-grounded out of the box; users can disable for cheaper /
    # general-knowledge replies.
    web_search: bool = True
    # Optional Ghana region scope (e.g. "Ashanti", "Brong Ahafo"). When set,
    # the system prompt narrows analysis to that region — used by the Demand
    # & Supply Forecast page where the user clicks a region on the map.
    region: str | None = None


SYSTEM_PROMPT = """You are an agricultural-market analyst helping users \
understand Ghana food market data. The user is currently looking at the \
crop: **{crop}**{region_clause}.

When asked questions, focus on this crop{region_focus} unless the user pivots. \
Use the web_search tool to find recent and accurate information — production \
volumes, prices, weather/climate signals, policy changes, regional dynamics, \
trade flows. Prefer sources like FAOSTAT, the Ghana Statistical Service \
(GSS), Ministry of Food & Agriculture (MoFA), WFP HungerMap, World Bank, \
news outlets.

Be concise and direct. When you have specific numbers, cite them with year \
and source. When you don't, say so plainly rather than guessing. \
Bullet lists are fine for multi-part answers; default to short paragraphs \
otherwise."""


@router.post("/chat")
async def chat(req: ChatRequest):
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY not configured. Set it in .env to enable the chat panel.",
        )

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)

    tools = (
        [{
            "type": "web_search_20250305",
            "name": "web_search",
            "max_uses": 5,
        }]
        if req.web_search
        else []
    )

    async def event_stream():
        try:
            async with client.messages.stream(
                model="claude-sonnet-4-5",
                max_tokens=2048,
                system=SYSTEM_PROMPT.format(
                    crop=req.crop,
                    region_clause=f" in **{req.region}** region" if req.region else "",
                    region_focus=f" within {req.region}" if req.region else "",
                ),
                messages=[{"role": m.role, "content": m.content} for m in req.messages],
                tools=tools,
            ) as stream:
                async for text in stream.text_stream:
                    yield f"data: {json.dumps({'type': 'text', 'text': text})}\n\n"
                yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
