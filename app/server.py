"""FastAPI app: serves the widget and runs one agent per call (one browser WebSocket)."""

import logging
import secrets

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

from app.agent import run_agent
from app.bridge import BrowserBridge
from app.config import ROOT, settings
from app.store import store

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger(__name__)

app = FastAPI(title="Ajman Department of Finance voice assistant", docs_url=None, redoc_url=None)
active_calls = 0


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    if settings.allowed_embed_origins and response.headers.get("content-type", "").startswith("text/html"):
        # Only the listed websites may embed the call page in an iframe.
        ancestors = " ".join(("'self'", *settings.allowed_embed_origins))
        response.headers["Content-Security-Policy"] = f"frame-ancestors {ancestors}"
    if request.url.path == "/widget.js":
        response.headers["Cache-Control"] = "public, max-age=300"
    return response


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "active_calls": active_calls}


@app.get("/admin/callbacks")
async def callbacks(token: str = "") -> list[dict]:
    if not settings.admin_token or not secrets.compare_digest(token, settings.admin_token):
        raise HTTPException(status_code=404)
    return store.all("callbacks")


@app.websocket("/ws")
async def websocket(ws: WebSocket, lang: str = "en") -> None:
    global active_calls
    await ws.accept()
    bridge = BrowserBridge(ws)
    if active_calls >= settings.max_concurrent_calls:
        await bridge.send({"type": "busy"})
        await ws.close()
        return
    active_calls += 1
    log.info("Call started (%d active)", active_calls)
    try:
        await run_agent(bridge, "ar" if lang == "ar" else "en")
    except* WebSocketDisconnect:
        pass
    except* TimeoutError:
        log.info("Call reached the time limit")
    except* Exception as group:
        log.exception("Call ended with an error", exc_info=group)
        try:
            await bridge.send({"type": "error"})
        except Exception:
            pass  # the browser is already gone
    finally:
        active_calls -= 1
        log.info("Call ended (%d active)", active_calls)
        try:
            await ws.close()
        except Exception:
            pass


app.mount("/", StaticFiles(directory=ROOT / "static", html=True), name="static")
