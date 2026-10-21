# LMScrap

A Chrome extension that downloads course materials from
[new BINUSMAYA](https://newbinusmaya.binus.ac.id): pick a **mata kuliah**, tick a
**range of sessions**, and it saves their files to `Downloads/LMScrap/`.

It reuses your existing browser login — no password, no re-login. It watches the
dashboard's own API calls, borrows the bearer token, and calls the same API
(`active classes → sessions → resources → download URL`).

## Install

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top-right)
3. **Load unpacked** → pick this folder

## Use

1. Open and **log in** to https://newbinusmaya.binus.ac.id — stay on the dashboard
   a moment so the extension captures your token.
2. Click the **LMScrap** toolbar icon.
3. Choose a course, then either tick sessions or set a range (`from` / `to` →
   **Tick range**).
4. **Scrape selected**. For each selected session you get, under
   `Downloads/LMScrap/<course>/<NN_topic>/`:
   - the original file (`.pptx`, `.pdf`, …)
   - `<name>.md` — slide text pulled out of each `.pptx`
   And one `Downloads/LMScrap/<course>/quiz_handoff.md` bundling all the extracted
   text under a ready-to-use prompt — paste or upload it to an AI to get a quiz.

If courses don't load, refresh the BINUSMAYA dashboard tab (that re-fires the API
call the token is captured from), then reopen the popup.

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
