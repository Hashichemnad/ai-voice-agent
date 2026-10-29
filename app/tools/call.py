"""Call control: the browser hangs up once end_call finishes and the goodbye has played."""

from app.tools.registry import tool


@tool
def end_call() -> dict:
    """Hang up. Only call this after the caller says goodbye or needs nothing else, and after you have said goodbye."""
    return {"status": "Call ended."}
