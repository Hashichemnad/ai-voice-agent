# Hamdan: voice assistant for the Ajman Department of Finance

Visitors tap a character on your website, hear a short ring, and Hamdan greets them in Arabic or English.
He answers questions about the Department's services, fees, Tawreed, Ajman Sadad and working hours,
and takes callback requests. He stays strictly on Department of Finance topics.

Built on the Gemini Live API, with FastAPI on the server and plain JavaScript in the browser.

## Run it on your computer

```
uv sync
cp .env.example .env        # Windows: copy .env.example .env
# put your GEMINI_API_KEY in .env
uv run python scripts/smoke_test.py      # optional: checks your key and model
uv run uvicorn app.server:app
```

Open http://localhost:8000 and tap the character in the bottom-right corner.

## Put it on Render

1. Push this folder to a GitHub repository.
2. In Render choose **New → Blueprint** and pick the repository. Render reads `render.yaml` and asks for
   `GEMINI_API_KEY` (and optionally `CALLBACK_WEBHOOK_URL` and `ADMIN_TOKEN`).
3. Before going live, check `ALLOWED_EMBED_ORIGINS` in the Render dashboard. Only these websites can show the
   widget. Clear it while testing on other sites.

An existing Render web service keeps working. Just redeploy it with the new code.

## Add it to the website

Paste this before `</body>` on every page that should show the character:

```html
<script src="https://YOUR-APP.onrender.com/widget.js" defer></script>
```

| Option | What it does |
|---|---|
| `data-lang="ar"` / `"en"` | Fixes the language. By default it follows the page (`<html lang="ar">` or `/ar/` in the URL). |
| `data-position="left"` | Puts the character in the bottom-left corner. |
| `data-greeting="off"` | Hides the "Talk to Hamdan" bubble. |
| `data-noise-filter="on"` | Adds the extra neural noise filter (RNNoise). Off by default; try it if callers are often in noisy places. |
| `data-echo-guard="off"` | Turns off the echo guard. Only sensible if all callers wear headphones. |

Any button on the site can open the widget: `<button onclick="AjmanDofVoice.open()">Talk to us</button>`.
A full-page version is at `/call.html` (add `?lang=ar` for Arabic), which is useful for a QR code or a link in an email.

## Change what Hamdan knows and says

| File | What it controls |
|---|---|
| `app/data/ajmandof.json` | Services, fees, documents, steps, FAQ, contact details. Edit this when the website changes; no code needed. |
| `app/persona/ajmandof.md` | Personality, greeting, scope, rules for noisy calls, privacy and callbacks. |
| `app/tools/ajmandof.py` | What he can do: look up services, search the FAQ, log a callback. |
| `static/hamdan.svg` | The character. |
| `static/call.css` | Colours (top of the file), fonts and layout of the call panel. |

## Settings (environment variables)

| Name | Default | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | none (required) | Your Gemini key. |
| `VOICE` | `Charon` | Voice of the assistant (`Kore` is a female voice). |
| `MODEL` | `gemini-3.8-live` | Gemini Live model. |
| `MAX_CONCURRENT_CALLS` | `3` | Further callers hear "all lines are busy". Raise it on a paid key. |
| `MAX_CALL_MINUTES` | `10` | Hamdan wraps up politely a minute before the limit. |
| `SILENCE_MS` | `800` | Pause (ms) that ends the caller's turn. Raise it if Hamdan answers while callers are still talking. |
| `ALLOWED_EMBED_ORIGINS` | empty (any site) | Websites allowed to embed the widget. |
| `CALLBACK_WEBHOOK_URL` | empty | Callback requests are POSTed here as JSON, with a ready-made `text` line for Teams or email flows. |
| `ADMIN_TOKEN` | empty | Enables `/admin/callbacks?token=...`, a list of callback requests since the last restart. |
| `PROACTIVE_AUDIO` | `false` | Lets the model ignore speech not addressed to it. Try it for very noisy places. |

## How noise and echo are handled

1. **Browser noise suppression and echo cancellation** are always on.
2. **Echo guard:** while Hamdan is speaking, and for half a second afterwards, the mic sends silence, so his own
   voice coming out of the speakers can't make him stop mid-sentence. If the caller speaks clearly louder than the
   echo for 120 ms, they still get through and can cut in.
3. **Optional neural noise filter (RNNoise):** turn it on with `data-noise-filter="on"`.
4. **The persona** tells Hamdan to ignore background conversations, ask callers to repeat instead of guessing,
   and offer the keyboard button if the line stays unclear.

### Troubleshooting a call

Open `/call.html?debug=1` (add `&nf=on` to include the noise filter). Under the status line you'll see the mic
level, whether the echo guard is open or closed, and how many times Hamdan was interrupted. In the Render logs,
"Hamdan was interrupted by audio from the caller's side" while nobody spoke means the mic is hearing the speakers.

## Before going live

- **Use a paid Gemini key (or Vertex AI).** On the free tier Google may use conversations to improve its models.
- **Send callbacks somewhere real.** Set `CALLBACK_WEBHOOK_URL`. On free hosting, saved files are wiped on every restart.
- **Avoid the cold start.** Render's free plan sleeps after 15 minutes without visitors, and the first caller then waits about a minute. A paid instance avoids this.
- **Get approval** from IT security and data protection, because callers' voices are processed by an external AI service.
