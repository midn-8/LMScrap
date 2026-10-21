# LMScrap

A Chrome extension that downloads course materials from
[BINUSMAYA LMS](https://lms.binus.ac.id): pick a **mata kuliah**, tick a
**range of sessions**, and it saves their files to `Downloads/LMScrap/`.

It reuses your existing browser login — no password, no re-login. It watches the
dashboard's own API calls, borrows the bearer token, and calls the same API
(`active classes → sessions → resources → download URL`).

## Install

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top-right)
3. **Load unpacked** → pick this folder

## Use

1. Open and **log in** to https://lms.binus.ac.id — just loading the page lets the
   extension capture your token (a content script hooks the app's API calls).
2. Click the **LMScrap** toolbar icon.
3. Choose a course, then either tick sessions or set a range (`from` / `to` →
   **Tick range**).
4. Pick outputs: **Slides (.pptx)**, **Slide text (.md)**, **Quiz handoff**.
5. **Scrape selected** → files save under `Downloads/LMScrap/<course>/<NN_topic>/`.
6. If **Quiz handoff** was on, a row appears: **Claude / ChatGPT / Gemini / Save .md**.
   Clicking an AI opens it and auto-sends the combined material + a quiz/flashcard
   prompt (clipboard backup, so Ctrl+V works if a site's auto-send misses). The
   handoff persists, so you can reopen the popup later and resend without rescraping.

If courses don't load, reload your lms.binus.ac.id tab, then reopen the popup.

## Notes

- Downloads real files (PPT/PDF/DOC…); videos, Zoom and external links are skipped.
- `.md` + quiz handoff cover `.pptx` only (slide text). `.pdf` files download but
  aren't turned into `.md` yet.
- `node test_bg.mjs` and `node test_pptx.mjs` run offline checks of the helpers
  and the slide-text extraction.
- BINUS API field names can change; if a course or session is empty, inspect the
  responses in DevTools → Network and adjust the keys in `background.js`.
- For your own academic use. Check BINUS's terms before automating access.

### Alternative: `scrape.py`

A standalone Python/Playwright version is also in this folder — it downloads
**all** active courses at once and **extracts slide text** to `.txt`. See the
header of `scrape.py`. Use it if you want every course in one run, or the text.
