// Smoke test for background.js pure helpers (copied here; no chrome APIs).
import assert from "node:assert";

const asList = (x, ...keys) =>
  Array.isArray(x) ? x : (keys.map((k) => x?.[k]).find(Array.isArray) || []);
const safe = (s) =>
  String(s).replace(/[<>:"/\\|?*\n\r\t]/g, "_").replace(/^[ .]+|[ .]+$/g, "").slice(0, 120) || "untitled";
const hasExt = (s) => /\.[a-z0-9]{2,5}$/i.test(s);
const extFromUrl = (url) => {
  try { return (new URL(url).pathname.match(/\.[a-z0-9]{2,5}$/i) || [""])[0]; }
  catch { return ""; }
};

assert.deepEqual(asList([1, 2]), [1, 2]);
assert.deepEqual(asList({ sessions: [3] }, "sessions", "data"), [3]);
assert.deepEqual(asList({ data: [4] }, "sessions", "data"), [4]);
assert.deepEqual(asList({ nope: 1 }, "sessions"), []);
assert.deepEqual(asList(null), []);

assert.equal(safe('a/b:c*?"<>|'), "a_b_c______");
assert.equal(safe("  ..deck.. "), "deck");
assert.equal(safe(""), "untitled");

assert.equal(hasExt("Week1.pptx"), true);
assert.equal(hasExt("Week1 Intro"), false);
assert.equal(extFromUrl("https://x.blob.core.windows.net/a/deck.pptx?sig=abc"), ".pptx");
assert.equal(extFromUrl("not a url"), "");

console.log("ok");
