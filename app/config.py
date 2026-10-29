"""Settings (from environment variables or .env) and the Gemini Live session config."""

import os
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from google.genai import types

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent
TIMEZONE = ZoneInfo("Asia/Dubai")


def env_list(name: str) -> tuple[str, ...]:
    return tuple(v.strip() for v in os.getenv(name, "").split(",") if v.strip())


@dataclass(frozen=True)
class Settings:
    model: str = os.getenv("MODEL", "gemini-3.8-live")
    voice: str = os.getenv("VOICE", "Charon")
    persona_file: Path = ROOT / os.getenv("PERSONA_FILE", "app/persona/ajmandof.md")
    tool_modules: tuple[str, ...] = env_list("TOOL_MODULES") or ("app.tools.ajmandof", "app.tools.call")
    # Protect your Gemini quota: calls at once, and minutes per call.
    max_concurrent_calls: int = int(os.getenv("MAX_CONCURRENT_CALLS", "3"))
    max_call_minutes: int = int(os.getenv("MAX_CALL_MINUTES", "10"))
    # Websites allowed to embed the widget, e.g. "https://ajmandof.ae,https://www.ajmandof.ae". Empty = any.
    allowed_embed_origins: tuple[str, ...] = field(default_factory=lambda: env_list("ALLOWED_EMBED_ORIGINS"))
    # Optional: each callback request is POSTed here as JSON (Power Automate, Zapier, Teams, your CRM...).
    callback_webhook_url: str = os.getenv("CALLBACK_WEBHOOK_URL", "")
    # Optional: set to view callback requests at /admin/callbacks?token=...
    admin_token: str = os.getenv("ADMIN_TOKEN", "")
    # Optional: lets the model ignore speech that isn't meant for it (background talk). Not every model supports it.
    proactive_audio: bool = os.getenv("PROACTIVE_AUDIO", "false").lower() == "true"


settings = Settings()


def now() -> datetime:
    return datetime.now(TIMEZONE)


def system_prompt(persona_file: Path, lang: str) -> str:
    """The persona, prefixed with the current date/time and the website language the caller came from."""
    language = "Arabic" if lang == "ar" else "English"
    return (
        f"Current date and time in Ajman: {now():%A %d %B %Y, %I:%M %p}.\n"
        f"The caller opened the {language} version of the website, so greet them in {language} first.\n\n"
        + persona_file.read_text(encoding="utf-8")
    )


def build_live_config(settings: Settings, registry=None, lang: str = "en") -> types.LiveConnectConfig:
    """Voice, persona, transcripts, noise-tolerant turn detection and tools for one call."""
    return types.LiveConnectConfig(
        response_modalities=[types.Modality.AUDIO],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=settings.voice))
        ),
        system_instruction=system_prompt(settings.persona_file, lang),
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        realtime_input_config=types.RealtimeInputConfig(
            automatic_activity_detection=types.AutomaticActivityDetection(
                # LOW start sensitivity: short noises (doors, keyboards, coughs) don't count as speech.
                start_of_speech_sensitivity=types.StartSensitivity.START_SENSITIVITY_LOW,
                # HIGH end sensitivity: the turn still ends promptly when background hum continues.
                end_of_speech_sensitivity=types.EndSensitivity.END_SENSITIVITY_HIGH,
                prefix_padding_ms=200,  # Speech must last 200 ms before it can start a turn.
                silence_duration_ms=800,
            )
        ),
        proactivity=types.ProactivityConfig(proactive_audio=True) if settings.proactive_audio else None,
        tools=[types.Tool(function_declarations=registry.declarations)] if registry else None,
        # Keeps long calls going past the model's context limit.
        context_window_compression=types.ContextWindowCompressionConfig(sliding_window=types.SlidingWindow()),
    )
