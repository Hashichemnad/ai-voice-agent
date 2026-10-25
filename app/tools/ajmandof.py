"""Customer support tools for the Ajman Department of Finance. Each @tool becomes a Live API function.

All answers come from app/data/ajmandof.json. Update that file when the website changes;
no code changes are needed.
"""

import json
import logging
import random
import re
from datetime import datetime
from pathlib import Path
from typing import Literal

from app.config import TIMEZONE
from app.store import store
from app.tools.registry import ToolError, tool

log = logging.getLogger(__name__)

DOF = json.loads((Path(__file__).parent.parent / "data" / "ajmandof.json").read_text(encoding="utf-8"))
SERVICES: dict[str, dict] = DOF["services"]

Audience = Literal["individuals", "businesses", "government_entities", "all"]
Section = Literal["services", "tenders", "open_data", "legislation", "media_center", "digital_participation", "client_dashboard"]


def words(text: str) -> set[str]:
    """Lower-case words in English or Arabic, ignoring punctuation."""
    return set(re.findall(r"\w+", text.lower()))


def score(query: str, *texts: str) -> int:
    """How well a spoken query matches some text: exact phrase hits count most, then shared words."""
    q = query.lower().strip()
    points = 0
    for text in texts:
        t = text.lower()
        if q and (q in t or t in q):
            points += 10
        points += len(words(q) & words(t))
    return points


@tool
def list_services(audience: Audience = "all") -> dict:
    """List the Department of Finance e-services, optionally only those for one audience.

    Args:
        audience: Who the services are for: individuals, businesses (suppliers), government_entities, or all.
    """
    wanted = {"individuals": "individual", "businesses": "business", "government_entities": "government"}.get(audience)
    found = [
        {"service": s["name"], "service_ar": s["name_ar"], "audience": s["audience"]}
        for s in SERVICES.values()
        if not wanted or wanted in s["audience"].lower()
    ]
    return {"count": len(found), "services": found}


@tool
def get_service_details(service: str) -> dict:
    """Get the official details of one service: who it is for, conditions, documents, steps, fees and processing time.

    Args:
        service: The service the customer asked about, in their words, e.g. "register as a supplier" or "Sadad wallet".
    """
    ranked = sorted(
        SERVICES.values(),
        key=lambda s: score(service, s["name"], s["name_ar"], *s["aliases"]),
        reverse=True,
    )
    best = ranked[0]
    if score(service, best["name"], best["name_ar"], *best["aliases"]) == 0:
        raise ToolError("I couldn't find that service. Ask what they want to do, or use list_services.")
    return {k: v for k, v in best.items() if k != "aliases"}


@tool
def search_faq(question: str) -> dict:
    """Search the official FAQ, mainly about supplier registration, the Tawreed platform, tenders and tracking requests.

    Args:
        question: The customer's question in their words.
    """
    ranked = sorted(DOF["faq"], key=lambda f: score(question, f["q"], *f["keywords"]), reverse=True)
    hits = [f for f in ranked[:2] if score(question, f["q"], *f["keywords"]) > 0]
    if not hits:
        return {"answers": [], "message": "No FAQ answer found. Do not guess; offer a callback."}
    return {"answers": [{"question": f["q"], "answer": f["a"]} for f in hits]}


@tool
def get_contact_info() -> dict:
    """Get the Department's call center number, email, address, P.O. Box, working hours and online channels."""
    return DOF["contact"]


@tool
def get_website_section(section: Section) -> dict:
    """Explain what a section of ajmandof.ae is for, e.g. tenders, open data or the client dashboard.

    Args:
        section: The website section the customer asked about.
    """
    return {"section": section, "info": DOF["website_sections"][section]}


@tool
def request_callback(name: str, phone: str, topic: str) -> dict:
    """Log a callback from a Department of Finance employee. Only call this after reading back the name, phone and topic and the customer confirming.

    Args:
        name: Customer's full name.
        phone: UAE phone number to call back, e.g. 0501234567.
        topic: Short summary of what the customer needs help with.
    """
    if not name.strip():
        raise ToolError("I need the customer's name.")
    digits = re.sub(r"\D", "", phone)
    if not 9 <= len(digits) <= 12:
        raise ToolError("That phone number doesn't look right. Ask the customer to repeat it.")
    ticket = store.add("callbacks", {
        "reference": f"DOF-{random.randint(100000, 999999)}",
        "name": name.strip(),
        "phone": phone,
        "topic": topic,
        "created": datetime.now(TIMEZONE).strftime("%Y-%m-%d %H:%M"),
    })
    log.info("Callback requested: %s", ticket)
    return {**ticket, "next_step": "An employee will call back during working hours: Monday to Thursday 7:30 AM to 3:30 PM, Friday 7:30 AM to 12 noon."}
