// LMScrap background: sniff the BINUSMAYA bearer token from the SPA's own API
// calls, then reuse it to list courses/sessions, download materials, extract
// slide text to .md, and build a quiz-handoff file for an AI.
// Endpoints verified against lms.binus.ac.id (func-bm7-course-prod).
importScripts("fflate.js"); // exposes self.fflate

const BASE = "https://apim-bm7-prod-web.azure-api.net/func-bm7-course-prod";
// Real files land on BINUS blob storage but are often typed "Link" (not "Document")
// with a null type — so we decide by the URL's extension, not the resourceType.
const DOC_EXT = /\.(pdf|pptx?|docx?|xlsx?|zip|txt)$/i;

// Token is captured by capture.js (page hook) -> relay.js -> the "auth" message
// below. Deterministic, unlike webRequest sniffing.

async function getAuth() {
  const { auth } = await chrome.storage.session.get("auth");
  if (!auth) throw new Error("No login captured. Open (or reload) your lms.binus.ac.id tab, then retry.");
  return auth;
}

async function api(path) {
  const auth = await getAuth();
  const r = await fetch(BASE + path, {
    headers: {
      Authorization: auth.authorization,
      institution: "BNS01",
      academicCareer: "RS1",
      roleId: auth.roleId,
      roleName: "Student",
      rOId: auth.rOId,
      Accept: "application/json, text/plain, */*",
    },
  });
  if (r.status === 204) return null;
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
}

const asList = (x, ...keys) =>
  Array.isArray(x) ? x : (keys.map((k) => x?.[k]).find(Array.isArray) || []);

const safe = (s) =>
  String(s).replace(/[<>:"/\\|?*\n\r\t]/g, "_").replace(/^[ .]+|[ .]+$/g, "").slice(0, 120) || "untitled";

const hasExt = (s) => /\.[a-z0-9]{2,5}$/i.test(s);
const extFromUrl = (url) => {
  try { return (new URL(url).pathname.match(/\.[a-z0-9]{2,5}$/i) || [""])[0]; }
  catch { return ""; }
};

async function listClasses() {
  const periods = await api(`/AcademicPeriod/Student`);
  const cur = asList(periods).find((p) => p.isRunningPeriod) || asList(periods)[0];
  if (!cur?.academicPeriod) throw new Error("No running academic period found.");
  const lists = await Promise.all(
    ["LEC", "LAB"].map((c) =>
      api(`/Course/Period/${cur.academicPeriod}/Component/${c}/Student`).catch(() => []))
  );
  const classes = [];
  for (const list of lists)
    for (const c of asList(list))
      if (c.classId)
        classes.push({ id: c.classId, name: `${c.courseCode || ""} ${c.courseName || ""} (${c.ssrComponent})`.trim() });
  return classes;
}

async function listSessions(classId) {
  const d = await api(`/ClassSession/Class/${classId}/Student`);
  return asList(d, "sessions")
    .map((s) => ({ id: s.id, n: parseInt(s.classSessionNumber, 10) || 0 }))
    .filter((s) => s.id)
    .map((s) => ({ ...s, title: `Session ${s.n}` }));
}

const decodeXml = (s) => s
  .replace(/&apos;|&#39;/g, "'").replace(/&quot;|&#34;/g, '"')
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

// A .pptx is a zip of XML; slide text lives in <a:t> runs in ppt/slides/slideN.xml.
// Compacts for fewer tokens: collapses whitespace, drops 1-char noise, removes
// lines repeated across many slides (template header/footer/title), skips empty slides.
function pptxToMarkdown(bytes) {
  const files = fflate.unzipSync(bytes);
  const dec = new TextDecoder();
  const names = Object.keys(files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
  const perSlide = names.map((n) =>
    [...dec.decode(files[n]).matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
      .map((m) => decodeXml(m[1]).replace(/\s+/g, " ").trim())
      .filter((t) => t.length > 1));
  const freq = {};
  for (const lines of perSlide) for (const l of new Set(lines)) freq[l] = (freq[l] || 0) + 1;
  const boiler = Math.max(3, Math.ceil(perSlide.length * 0.4));
  const out = [];
  perSlide.forEach((lines, i) => {
    const kept = lines.filter((l) => freq[l] < boiler);
    if (kept.length) out.push(`## Slide ${i + 1}\n${kept.join("\n")}`);
  });
  return out.join("\n\n");
}

const dataUrl = (text, mime = "text/markdown") =>
  `data:${mime};charset=utf-8,` + encodeURIComponent(text);

const QUIZ_PROMPT =
  "**Task:** Using ONLY the course material below, create study material: " +
  "(1) a set of flashcards (term → definition) for the key concepts, and " +
  "(2) a quiz of 10 multiple-choice questions (4 options each) and 3 short-answer " +
  "questions. Put a full answer key at the end.";

async function scrape({ courseName, sessions, outputs }, report) {
  const o = outputs || { pptx: true, md: false, quiz: true };
  let files = 0, skipped = 0, mds = 0;
  const handoff = [];
  const found = {}; // what each session actually holds, for diagnostics
  for (const sess of sessions) {
    const d = await api(`/ClassSession/Session/${sess.id}/Resource/Student`);
    const topic = d?.topic || sess.title;
    const folder = `LMScrap/${safe(courseName)}/${String(sess.n).padStart(2, "0")}_${safe(topic)}`;
    for (const res of asList(d, "resources")) {
      const urlExt = extFromUrl(res.url);                              // ".pptx"
      const fileType = (res.type || urlExt.replace(".", "")).toLowerCase(); // "pptx" / "pdf"
      const isFile = !!res.url && (res.resourceType === "Document" || DOC_EXT.test(urlExt));
      const kind = isFile ? `file(${fileType || "?"})` : (res.resourceType || "?");
      found[kind] = (found[kind] || 0) + 1;
      if (!isFile) { skipped++; continue; }
      const name = safe(res.name);
      const ext = urlExt || (fileType ? `.${fileType}` : "");

      if (o.pptx) {
        try {
          await chrome.downloads.download({ url: res.url, filename: `${folder}/${name}${hasExt(name) ? "" : ext}` });
          files++;
          report(`saved ${name}${hasExt(name) ? "" : ext}`);
        } catch (e) { skipped++; report(`skip ${res.name}: ${e.message}`); }
      }

      // Extract slide text only when a .md or the quiz handoff needs it (pptx only).
      if ((o.md || o.quiz) && fileType === "pptx") {
        try {
          const bytes = new Uint8Array(await (await fetch(res.url)).arrayBuffer());
          const body = pptxToMarkdown(bytes);
          if (o.md) {
            await chrome.downloads.download({ url: dataUrl(`# ${res.name}\n\n${body}`), filename: `${folder}/${name}.md` });
            mds++;
            report(`md ${name}`);
          }
          if (o.quiz) handoff.push(`# Session ${sess.n}: ${topic}\n### Material: ${res.name}\n\n${body}`);
        } catch (e) { report(`extract fail ${res.name}: ${e.message}`); }
      }
    }
  }
  const handoffText = (o.quiz && handoff.length)
    ? `# Quiz source — ${courseName}\n\n${QUIZ_PROMPT}\n\n---\n\n` + handoff.join("\n\n---\n\n")
    : null;
  return { files, skipped, mds, handoffText, found };
}

chrome.runtime.onMessage.addListener((msg, _s, respond) => {
  if (msg.type === "auth") {
    if (msg.auth?.authorization) chrome.storage.session.set({ auth: msg.auth });
    return false;
  }
  (async () => {
    try {
      if (msg.type === "classes") respond({ ok: true, classes: await listClasses() });
      else if (msg.type === "sessions") respond({ ok: true, sessions: await listSessions(msg.classId) });
      else if (msg.type === "scrape") {
        const r = await scrape(msg, (line) =>
          chrome.runtime.sendMessage({ type: "progress", line }).catch(() => {}));
        respond({ ok: true, ...r });
      }
    } catch (e) { respond({ ok: false, error: e.message }); }
  })();
  return true; // keep the message channel open for the async response
});
