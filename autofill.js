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

  const submit = (el) => {
    const btn = document.querySelector(
      'button[data-testid="send-button"], button[aria-label*="Send" i], button[aria-label*="Submit" i], button[type="submit"]'
    );
    if (btn && !btn.disabled && visible(btn)) { btn.click(); return true; }
    const opts = { bubbles: true, cancelable: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 };
    el.dispatchEvent(new KeyboardEvent("keydown", opts));
    el.dispatchEvent(new KeyboardEvent("keyup", opts));
    return false;
  };

  const deadline = Date.now() + 25000;
  const tick = () => {
    const el = findComposer();
    if (el) {
      fill(el);
      setTimeout(() => submit(el), 600); // let the app register the text before sending
      return;
    }
    if (Date.now() < deadline) setTimeout(tick, 400);
  };
  tick();
})();
