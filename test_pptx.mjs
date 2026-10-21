// Round-trip test: zip fake slides, extract, check markdown. Uses the real fflate.
import assert from "node:assert";
import { createRequire } from "node:module";
const fflate = createRequire(import.meta.url)("./fflate.js");

// --- copies of the pure logic from background.js ---
const decodeXml = (s) => s
  .replace(/&apos;|&#39;/g, "'").replace(/&quot;|&#34;/g, '"')
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

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

const enc = (s) => new TextEncoder().encode(s);
const slide = (t) => enc(`<p:sld><p:txBody><a:p>${t}</a:p></p:txBody></p:sld>`);

// FOOTER repeats on all 3 slides -> boilerplate, must be dropped.
const zip = fflate.zipSync({
  "ppt/slides/slide1.xml": slide("<a:t>Title</a:t><a:t>Point A &amp; B</a:t><a:t>FOOTER</a:t>"),
  "ppt/slides/slide2.xml": slide("<a:t>Second &lt;slide&gt;</a:t><a:t>FOOTER</a:t>"),
  "ppt/slides/slide10.xml": slide("<a:t>Ten</a:t><a:t>FOOTER</a:t>"), // numeric sort, not lexical
  "docProps/core.xml": enc("<meta/>"), // ignored
});

const md = pptxToMarkdown(zip);
assert.match(md, /## Slide 1\nTitle\nPoint A & B/);
assert.match(md, /## Slide 2\nSecond <slide>/);
assert.ok(md.indexOf("## Slide 1") < md.indexOf("## Slide 2"), "slide order");
assert.ok(md.endsWith("Ten"), "slide10 sorts last, not after slide1");
assert.ok(!md.includes("FOOTER"), "boilerplate line dropped");
console.log("ok");
