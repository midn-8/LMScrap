const $ = (s) => document.querySelector(s);
const send = (msg) => chrome.runtime.sendMessage(msg);
const status = (t) => { $("#status").textContent = t; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// Each button queues the handoff for autofill.js, then opens the site's new chat.
const AI = {
  claude: "https://claude.ai/new",
  chatgpt: "https://chatgpt.com/",
  gemini: "https://gemini.google.com/app",
};

let sessions = [], handoffText = "", courseTag = "";

async function loadClasses() {
  status("Loading courses…");
  const r = await send({ type: "classes" });
  if (!r?.ok) { $("#course").innerHTML = "<option>—</option>"; return status(r?.error || "Open your lms.binus.ac.id tab, then reopen this."); }
  $("#course").innerHTML = '<option value="">— choose mata kuliah —</option>' +
    r.classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
  status(`${r.classes.length} course(s).`);
}

$("#course").onchange = async (e) => {
  $("#sessions").innerHTML = ""; sessions = []; $("#ai").hidden = true;
  if (!e.target.value) return;
  status("Loading sessions…");
  const r = await send({ type: "sessions", classId: e.target.value });
  if (!r?.ok) return status(r.error);
  sessions = r.sessions;
  $("#sessions").innerHTML = sessions.map((s) =>
    `<label><input type="checkbox" data-id="${s.id}" data-n="${s.n}"> ${String(s.n).padStart(2, "0")} — ${esc(s.title)}</label>`
  ).join("");
  $("#from").value = 1; $("#to").value = sessions.length;
  status(`${sessions.length} session(s). Tick some, or set a range.`);
};

$("#applyRange").onclick = () => {
  const from = +$("#from").value, to = +$("#to").value;
  document.querySelectorAll("#sessions input").forEach((cb) => {
    const n = +cb.dataset.n; cb.checked = n >= from && n <= to;
  });
};

$("#scrape").onclick = async () => {
  const ids = [...document.querySelectorAll("#sessions input:checked")].map((cb) => cb.dataset.id);
  const chosen = sessions.filter((s) => ids.includes(String(s.id)));
  if (!chosen.length) return status("Tick at least one session.");
  const outputs = { pptx: $("#optPptx").checked, md: $("#optMd").checked, quiz: $("#optQuiz").checked };
  if (!outputs.pptx && !outputs.md && !outputs.quiz) return status("Pick at least one output.");
  $("#log").textContent = ""; $("#ai").hidden = true; handoffText = "";
  courseTag = $("#course").selectedOptions[0].textContent;
  status(`Scraping ${chosen.length} session(s)…`);
  const r = await send({ type: "scrape", courseName: courseTag, sessions: chosen, outputs });
  if (!r?.ok) return status("Error: " + r?.error);
  handoffText = r.handoffText || "";
  status(`Done — ${r.files} file(s)${r.mds ? `, ${r.mds} .md` : ""}${handoffText ? ", quiz ready ↓" : ""}. See Downloads/LMScrap.`);
  if (handoffText) {
    chrome.storage.local.set({ lastHandoff: { text: handoffText, course: courseTag } });
    $("#ai").hidden = false;
  }
};

// Restore the last scrape's handoff so reopening the popup (after visiting another
// site, which closes it) keeps the AI buttons working without re-scraping.
async function restoreHandoff() {
  const { lastHandoff } = await chrome.storage.local.get("lastHandoff");
  if (lastHandoff?.text) {
    handoffText = lastHandoff.text;
    courseTag = lastHandoff.course || "";
    $("#ai").hidden = false;
    status(`Quiz ready from last scrape${courseTag ? ` — ${courseTag}` : ""}. Pick an AI below.`);
  }
}

// Robust copy: navigator.clipboard first, textarea+execCommand fallback (works in
// popups where the async clipboard API is blocked by focus rules).
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (_) {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.focus(); ta.select();
    const ok = document.execCommand("copy");
    ta.remove(); return ok;
  } catch (_) { return false; }
}

document.querySelectorAll("[data-ai]").forEach((b) => (b.onclick = () => openAI(b.dataset.ai)));

async function openAI(prov) {
  if (!handoffText) return;
  // Queue it for the content script on the AI site, which fills + submits.
  await chrome.storage.local.set({ pendingQuiz: { text: handoffText, provider: prov, ts: Date.now() } });
  await copyText(handoffText); // backup: if autofill misses, Ctrl+V still works
  chrome.tabs.create({ url: AI[prov] });
  status(`Opening ${prov} and auto-sending… (if it doesn't send, paste with Ctrl+V).`);
}

async function dlHandoff() {
  if (!handoffText) return;
  const url = "data:text/markdown;charset=utf-8," + encodeURIComponent(handoffText);
  await chrome.downloads.download({ url, filename: `LMScrap/${(courseTag || "course").replace(/\W+/g, "_")}/quiz_handoff.md` });
  status("Saved quiz_handoff.md to Downloads/LMScrap.");
}
$("#dlHandoff").onclick = dlHandoff;

chrome.runtime.onMessage.addListener((m) => {
  if (m.type !== "progress") return;
  const log = $("#log"); log.textContent += m.line + "\n"; log.scrollTop = log.scrollHeight;
});

(async () => { await loadClasses(); await restoreHandoff(); })();
