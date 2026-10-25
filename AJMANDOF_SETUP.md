# Ajman Department of Finance voice assistant

A bilingual (Arabic and English) voice assistant for ajmandof.ae, built on the Gemini Live API.
It answers only questions about the Department of Finance and its services, and logs callback requests.

## Run it

```
uv sync
cp .env.example .env        # Windows: copy .env.example .env
# paste your GEMINI_API_KEY into .env
uv run python scripts/smoke_test.py
uv run uvicorn app.server:app
```

Open http://localhost:8000, put on headphones and ask, for example:
- "How much does it cost to register my company as a supplier?"
- "كيف أفتح محفظة سداد عجمان؟"
- "What are your working hours?"
- "What's the weather today?" (it should politely refuse)

## What each file does

| File | What to change there |
|---|---|
| `app/persona/ajmandof.md` | The assistant's name, tone, scope and rules |
| `app/data/ajmandof.json` | Services, fees, documents, steps, FAQ and contact details. Update it when the website changes. No code changes needed |
| `app/tools/ajmandof.py` | The actions the assistant can take (look up a service, search the FAQ, log a callback) |
| `.env` | API key, model, voice (`VOICE=Charon` is male, `Kore` is female) |
| `static/` | The web page: title, colours, layout |

Callback requests are saved to `app/data/bookings.json` and shown in the "Callback requests" panel.

## Before going live on ajmandof.ae

1. **Use a paid key or Vertex AI.** On the free tier Google may use conversations to improve its models, and only a few calls can run at once.
2. **Host it on a server with HTTPS**, for example `voice.ajmandof.ae`. Browsers only allow the microphone on HTTPS.
3. **Add it to the website** as a "Talk to us" button that opens the assistant, or embed it:
   `<iframe src="https://voice.ajmandof.ae" allow="microphone" style="width:420px;height:640px;border:0"></iframe>`
4. **Send callbacks somewhere real**: replace the file store in `request_callback` with your CRM, ticketing system or an email to the call center team.
5. **Get approval** from your IT security and data protection teams, and the relevant Ajman Digital Government requirements, since customer voices and phone numbers are processed by an external AI service.
