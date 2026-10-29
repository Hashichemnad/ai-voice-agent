"""One phone call: streams the caller's voice to Gemini Live and Gemini's voice, captions and tool calls back."""

import asyncio
import logging

from google import genai

from app.bridge import BrowserBridge
from app.config import build_live_config, settings
from app.tools.registry import ToolRegistry

log = logging.getLogger(__name__)
client = genai.Client()  # Reads GEMINI_API_KEY (or the GOOGLE_CLOUD_* Vertex AI settings).

# Sent as the first message so the assistant greets the caller before they say anything.
CALL_CONNECTED = "[CALL_CONNECTED] The caller has just been connected. Greet them now."
WRAP_UP = "[SYSTEM] The call ends in one minute. Politely let the caller know and wrap up."


async def run_agent(bridge: BrowserBridge, lang: str = "en") -> None:
    registry = ToolRegistry(settings.tool_modules, on_event=bridge.tool_event)
    config = build_live_config(settings, registry, lang)

    async with client.aio.live.connect(model=settings.model, config=config) as session:
        await bridge.send({"type": "ready"})
        await session.send_realtime_input(text=CALL_CONNECTED)

        async def send_inputs():
            async for item in bridge.inputs():
                await session.send_realtime_input(**item)

        async def answer(tool_call):
            await session.send_tool_response(function_responses=await registry.run(tool_call))

        async def receive_replies():
            while True:  # receive() ends after every turn
                async for msg in session.receive():
                    await bridge.play(msg.data)
                    if msg.server_content and msg.server_content.interrupted:
                        # If this shows up in the logs while nobody spoke, the mic is hearing the speakers (echo).
                        log.info("Hamdan was interrupted by audio from the caller's side")
                        await bridge.interrupt()
                    if msg.tool_call:
                        tg.create_task(answer(msg.tool_call))  # keep audio flowing while tools run
                    await bridge.transcript(msg)

        async def time_limit():
            limit = settings.max_call_minutes * 60
            await asyncio.sleep(max(limit - 60, 0))
            await session.send_realtime_input(text=WRAP_UP)
            await asyncio.sleep(60)
            await bridge.send({"type": "hangup"})  # the browser hangs up once the goodbye has played
            await asyncio.sleep(20)
            raise TimeoutError("Call time limit reached")

        async with asyncio.TaskGroup() as tg:
            tg.create_task(send_inputs())
            tg.create_task(receive_replies())
            tg.create_task(time_limit())
