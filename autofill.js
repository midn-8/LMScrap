// Runs on the AI sites. When the popup queued a handoff for THIS provider, it
// fills the chat composer with the material + quiz prompt and submits it — no
// paste, no Enter. Best-effort: selectors differ per site and can change.
(async () => {
  let pending;
  try { ({ pendingQuiz: pending } = await chrome.storage.local.get("pendingQuiz")); } catch (_) { return; }
  if (!pending?.text) return;
  if (Date.now() - (pending.ts || 0) > 180000) { chrome.storage.local.remove("pendingQuiz"); return; }

  const host = location.hostname;
  const prov = host.includes("claude.ai") ? "claude"
    : host.includes("chatgpt.com") ? "chatgpt"
    : host.includes("gemini.google.com") ? "gemini" : null;
  if (!prov || prov !== pending.provider) return;

  await chrome.storage.local.remove("pendingQuiz"); // consume once; a refresh won't re-send
  const text = pending.text;

  const visible = (el) => el && el.offsetParent !== null && el.getClientRects().length > 0;
  const findComposer = () =>
    [...document.querySelectorAll('div[contenteditable="true"], textarea')]
      .filter(visible)
      .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] || null;

  const fill = (el) => {
    el.focus();
    if (el.tagName === "TEXTAREA") {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el); range.collapse(false);
      sel.removeAllRanges(); sel.addRange(range);
      document.execCommand("insertText", false, text); // fires beforeinput/input React listens to
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };

  // Fill only — the material rides along as an attached file, so we do NOT submit
  // (sending before the user attaches it would be useless) and never inject the
  // huge material text (that froze the editor). The composer gets a short prompt.
  const deadline = Date.now() + 25000;
  const tick = () => {
    const el = findComposer();
    if (el) { fill(el); return; }
    if (Date.now() < deadline) setTimeout(tick, 400);
  };
  tick();
})();
