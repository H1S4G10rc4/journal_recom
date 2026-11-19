import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  safeSource,
  sanitizeSVG,
  limitedFetch,
  figuresFromHTML,
  FigureCache,
} from "../src/figures.mjs";
test("figure fetch rejects local networks, alternate ports, and redirects off allowed sources", async () => {
  for (const u of [
    "http://arxiv.org/x",
    "https://127.0.0.1/x",
    "https://arxiv.org:8765/x",
    "https://user@arxiv.org/x",
    "https://arxiv.org.evil.test/x",
  ])
    assert.throws(() => safeSource(u));
  assert.throws(() =>
    sanitizeSVG('<svg><image href="file:///etc/passwd"/></svg>'),
  );
  assert.throws(() => sanitizeSVG("<!DOCTYPE x><svg/>"));
  assert.throws(() =>
    sanitizeSVG('<svg><style>@import "https://evil.test";</style></svg>'),
  );
  assert.doesNotThrow(() =>
    sanitizeSVG(
      '<svg xmlns="http://www.w3.org/2000/svg"><use href="#a"/></svg>',
    ),
  );
  await assert.rejects(
    limitedFetch("https://arxiv.org/x", {
      fetcher: async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/secret" },
        }),
    }),
  );
});
test("HTML figure fallback uses actual image/object URL, source anchor, and original caption", () => {
  const found = figuresFromHTML(
    '<figure id="S2.F1"><object data="2301.05387/assets/fig1.svg"></object><figcaption>Figure 1: Original &amp; caption</figcaption></figure>',
    "https://ar5iv.labs.arxiv.org/html/2301.05387",
  );
  assert.equal(
    found[0].image_url,
    "https://ar5iv.labs.arxiv.org/html/2301.05387/assets/fig1.svg",
  );
  assert.equal(
    found[0].source_url,
    "https://ar5iv.labs.arxiv.org/html/2301.05387#S2.F1",
  );
  assert.equal(found[0].originalCaption, "Figure 1: Original & caption");
});
test("cached original figures are encrypted and cannot be read with another key", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "paper-desk-figures-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const key = randomBytes(32),
    c = new FigureCache(dir, key),
    id = "a".repeat(32);
  c.write(id, Buffer.from("private original figure"));
  assert.equal(c.read(id).toString(), "private original figure");
  assert(
    !readFileSync(path.join(dir, id + ".enc")).includes(
      "private original figure",
    ),
  );
  assert.throws(() => new FigureCache(dir, randomBytes(32)).read(id));
});
