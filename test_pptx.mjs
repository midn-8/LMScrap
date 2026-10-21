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
  const slides = Object.keys(files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
  return slides.map((n, i) => {
    const xml = dec.decode(files[n]);
    const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
      .map((m) => decodeXml(m[1])).filter((t) => t.trim());
    return `## Slide ${i + 1}\n\n${texts.join("\n") || "_(no text)_"}`;
  }).join("\n\n");
}

const enc = (s) => new TextEncoder().encode(s);
const slide = (t) => enc(`<p:sld><p:txBody><a:p>${t}</a:p></p:txBody></p:sld>`);

const zip = fflate.zipSync({
  "ppt/slides/slide1.xml": slide("<a:t>Title</a:t><a:t>Point A &amp; B</a:t>"),
  "ppt/slides/slide2.xml": slide("<a:t>Second &lt;slide&gt;</a:t>"),
  "ppt/slides/slide10.xml": slide("<a:t>Ten</a:t>"), // numeric sort, not lexical
  "docProps/core.xml": enc("<meta/>"), // ignored
});

const md = pptxToMarkdown(zip);
assert.match(md, /## Slide 1\n\nTitle\nPoint A & B/);
assert.match(md, /## Slide 2\n\nSecond <slide>/);
assert.ok(md.indexOf("## Slide 1") < md.indexOf("## Slide 2"), "slide order");
assert.ok(md.endsWith("Ten"), "slide10 sorts last, not after slide1");
console.log("ok");
