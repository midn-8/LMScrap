"""Scrape course materials from new BINUSMAYA.

Log in once in the browser window that opens; the Microsoft SSO session is saved
in ./.browser and reused on later runs. A fresh bearer token is grabbed from the
SPA's own API calls each run, so nothing expires between runs.

    pip install -r requirements.txt
    playwright install chromium
    python scrape.py            # scrape -> ./materials/ + materials/index.json
    python scrape.py --selftest # offline check, no browser/network
"""
import sys, re, json, pathlib, mimetypes
import requests

BASE = "https://apim-bm7-prod.azure-api.net"
COURSE = f"{BASE}/func-bm7-course-prod"
LMS_URL = "https://newbinusmaya.binus.ac.id/lms"
HERE = pathlib.Path(__file__).parent
USER_DATA = HERE / ".browser"
OUT = HERE / "materials"


def capture_auth(timeout_s: int = 600):
    """Open a real browser, let the user log in once, and sniff a live
    Authorization + roleId from the SPA's first API call to the course host."""
    from playwright.sync_api import sync_playwright  # imported late so --selftest needs no install

    got = {}
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(str(USER_DATA), headless=False)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()

        def on_request(req):
            if "token" in got or BASE not in req.url:
                return
            h = req.headers
            auth, role = h.get("authorization", ""), h.get("roleid", "")
            if auth.startswith("Bearer ") and role:
                got["token"], got["roleId"] = auth, role

        ctx.on("request", on_request)
        page.goto(LMS_URL)
        print("Log in if prompted. Waiting for a live token from the dashboard...")
        for _ in range(timeout_s):
            if "token" in got:
                break
            page.wait_for_timeout(1000)
        ctx.close()

    if "token" not in got:
        sys.exit("No token captured — did you finish logging in and reach the dashboard?")
    return got["token"], got["roleId"]


def client(token, role_id):
    s = requests.Session()
    s.headers.update({
        "Authorization": token,
        "institution": "BNS01",
        "academicCareer": "RS1",
        "roleId": role_id,
        "roleName": "Student",
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        "Origin": "https://newbinusmaya.binus.ac.id",
        "Referer": "https://newbinusmaya.binus.ac.id/",
    })
    return s


def get(s, path):
    r = s.get(f"{BASE}{path}")
    if r.status_code == 204:
        return None
    r.raise_for_status()
    return r.json()


def as_list(x, *keys):
    """APIM endpoints return either a bare list or {someKey: [...]}; normalize."""
    if isinstance(x, list):
        return x
    if isinstance(x, dict):
        for k in keys:
            if isinstance(x.get(k), list):
                return x[k]
    return []


def safe(name):
    return re.sub(r'[<>:"/\\|?*\n\r\t]', "_", str(name)).strip(" .")[:150] or "untitled"


def download(url, dest: pathlib.Path):
    """Blob URLs are pre-signed, so download without our API headers."""
    with requests.get(url, stream=True) as r:
        r.raise_for_status()
        if not dest.suffix:
            ext = mimetypes.guess_extension(r.headers.get("content-type", "").split(";")[0].strip() or "")
            dest = dest.with_suffix(ext or ".bin")
        dest.parent.mkdir(parents=True, exist_ok=True)
        with open(dest, "wb") as f:
            for chunk in r.iter_content(1 << 16):
                f.write(chunk)
    return dest


def extract_text(path: pathlib.Path):
    """Pull text from a downloaded deck/doc. Returns text, or None if unsupported.
    Libs imported late so --selftest and non-extraction runs need nothing extra."""
    suf = path.suffix.lower()
    if suf == ".pptx":
        from pptx import Presentation
        out = []
        for i, slide in enumerate(Presentation(str(path)).slides, 1):
            parts = [sh.text for sh in slide.shapes
                     if sh.has_text_frame and sh.text.strip()]
            if parts:
                out.append(f"--- Slide {i} ---\n" + "\n".join(parts))
        return "\n\n".join(out)
    if suf == ".pdf":
        from pypdf import PdfReader
        out = []
        for i, pg in enumerate(PdfReader(str(path)).pages, 1):
            t = (pg.extract_text() or "").strip()
            if t:
                out.append(f"--- Page {i} ---\n{t}")
        return "\n\n".join(out)
    return None


def main():
    token, role_id = capture_auth()
    s = client(token, role_id)

    classes = as_list(get(s, "/func-bm7-course-prod/Class/Active/Student"), "classes")
    print(f"{len(classes)} active class(es)")
    index = []

    for c in classes:
        class_id = c.get("classId") or c.get("id")
        course = safe(f"{c.get('courseCode','')} {c.get('courseName') or c.get('className','')}".strip())
        if not class_id:
            continue
        sessions = as_list(get(s, f"/func-bm7-course-prod/ClassSession/Class/{class_id}/Student"), "sessions", "data")
        print(f"- {course}: {len(sessions)} session(s)")

        for i, sess in enumerate(sessions, 1):
            sess_id = sess.get("id") or sess.get("sessionId")
            label = safe(f"{i:02d} {sess.get('title') or sess.get('topic') or sess_id}")
            if not sess_id:
                continue
            detail = get(s, f"/func-bm7-course-prod/ClassSession/Session/{sess_id}/Resource/Student") or {}
            for res in as_list(detail, "resources"):
                rid = res.get("id")
                title = res.get("name") or res.get("title") or rid
                rtype = res.get("resourceType", "")
                entry = {"course": course, "session": label, "title": title, "type": rtype}
                try:
                    meta = get(s, f"/func-bm7-course-prod/ClassSession/Session/Resource/{rid}") or {}
                    url = meta.get("url")
                    # Download real files (PPT/PDF/DOC...); only skip streaming/external types.
                    streamed = rtype.lower() in {"video", "link", "url", "zoom", "youtube"}
                    if url and not streamed:
                        path = download(url, OUT / course / label / safe(title))
                        entry["file"] = str(path.relative_to(HERE))
                        print(f"    saved {entry['file']}")
                        text = extract_text(path)
                        if text:
                            tpath = path.with_suffix(path.suffix + ".txt")
                            tpath.write_text(text, encoding="utf-8")
                            entry["text_file"] = str(tpath.relative_to(HERE))
                            print(f"    text  {entry['text_file']}")
                    elif url:
                        entry["url"] = url  # video/link: record, don't download
                except Exception as e:
                    entry["error"] = str(e)
                index.append(entry)

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "index.json").write_text(json.dumps(index, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nDone. {len(index)} resource(s) indexed -> {OUT / 'index.json'}")


def _selftest():
    assert safe('a/b:c*?"<>|') == "a_b_c______"  # 6 specials after c
    assert safe("  ...  ") == "untitled"
    assert safe("x" * 300) == "x" * 150
    assert as_list([1, 2]) == [1, 2]
    assert as_list({"resources": [3]}, "resources") == [3]
    assert as_list({"nope": 1}, "resources") == []
    assert as_list(None) == []
    print("selftest ok")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
    else:
        main()
