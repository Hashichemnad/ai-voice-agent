"""The browser WebSocket, as seen by the agent.

Browser -> server: binary frames are 16 kHz PCM16 mic audio; text frames are {"type": "text", "text": ...}.
Server -> browser: binary frames are 24 kHz PCM16 agent audio; text frames are JSON events for the UI.
"""

import json
from collections.abc import AsyncIterator

from fastapi import WebSocket, WebSocketDisconnect
from google.genai import types

MAX_TEXT = 500  # characters per typed message


class BrowserBridge:
    def __init__(self, ws: WebSocket) -> None:
        self.ws = ws

    async def inputs(self) -> AsyncIterator[dict]:
        """Yield kwargs for session.send_realtime_input: mic audio or typed text."""
        while True:
            message = await self.ws.receive()
            if message["type"] == "websocket.disconnect":
                raise WebSocketDisconnect(message.get("code", 1000))
            if message.get("bytes"):
                yield {"audio": types.Blob(data=message["bytes"], mime_type="audio/pcm;rate=16000")}
            elif message.get("text"):
                try:
                    text = str(json.loads(message["text"]).get("text", "")).strip()[:MAX_TEXT]
                except (ValueError, AttributeError):
                    continue
                if text:
                    yield {"text": text}

    async def play(self, audio: bytes | None) -> None:
        if audio:
            await self.ws.send_bytes(audio)

    async def interrupt(self) -> None:
        """The caller started talking: drop queued agent audio right away."""
        await self.send({"type": "interrupt"})

    async def transcript(self, msg: types.LiveServerMessage) -> None:
        """Forward caption snippets and end-of-turn markers."""
        content = msg.server_content
        if not content:
            return
        if content.input_transcription and content.input_transcription.text:
            await self.send({"type": "transcript", "role": "user", "text": content.input_transcription.text})
        if content.output_transcription and content.output_transcription.text:
            await self.send({"type": "transcript", "role": "agent", "text": content.output_transcription.text})
        if content.turn_complete:
            await self.send({"type": "turn_complete"})

    async def tool_event(self, event: dict) -> None:
        """Tell the UI a lookup is running (name only: no caller data goes back to the browser)."""
        await self.send({"type": "tool", "phase": event["phase"], "name": event["name"]})
        if event["phase"] == "end" and event["name"] == "end_call":
            await self.send({"type": "hangup"})

    async def send(self, event: dict) -> None:
        await self.ws.send_text(json.dumps(event, ensure_ascii=False, default=str))
