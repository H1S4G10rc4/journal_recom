import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  Vault,
  buildProfile,
  canonicalId,
  isDue,
  dateInZone,
} from "../src/store.mjs";
import { Research, validatePaper } from "../src/research.mjs";
const answers = {
  purpose: "博士課程。記憶の機構を調べる。",
  themeA: "神経回路のモデル",
  themeB: "細胞検出と確率的統合",
  methods: "数理モデルと実画像で比較する。",
  scope: "実験的な検証を重視する。",
  known: "既知と読了は区別する。",
  style: "日本語。数式と原図も。",
};
function temp(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "paper-desk-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test("vault encrypts profile, reading records and memos; wrong password fails without changing files", (t) => {
  const dir = temp(t),
    v = new Vault(dir);
  v.initialize("test-password-123");
  v.change((d) => {
    d.profile = buildProfile(answers);
    d.papers.push({ memo: "private unique memo" });
  });
  const cipher = readFileSync(v.file);
  assert(!cipher.includes("private unique memo"));
  assert(!cipher.includes("神経回路"));
  v.close();
  const fresh = new Vault(dir);
  assert.throws(() => fresh.unlock("wrong-password"));
  assert.deepEqual(readFileSync(v.file), cipher);
  fresh.unlock("test-password-123");
  assert.equal(fresh.data.papers[0].memo, "private unique memo");
  fresh.change((d) => {
    d.papers[0].read = true;
  });
  fresh.close();
  const again = new Vault(dir);
  again.unlock("test-password-123");
  assert.equal(again.data.papers[0].read, true);
  assert.throws(() => again.initialize("new-password"));
  again.close();
});
test("failed mutations roll back in memory and on disk", (t) => {
  const v = new Vault(temp(t));
  v.initialize("test-password-123");
  assert.throws(() =>
    v.change((d) => {
      d.profile = "invalid";
      throw Error("oops");
    }),
  );
  assert.equal(v.data.profile, null);
  v.close();
});
test("scheduling respects timezone, disabled updates, missing themes, and completed days", () => {
  const profile = buildProfile(answers),
    d = {
      profile,
      papers: [],
      schedule: { timezone: "Asia/Tokyo", time: "06:00", enabled: true },
    };
  assert.equal(
    dateInZone(new Date("2026-11-18T21:00:00Z"), "Asia/Tokyo"),
    "2026-11-19",
  );
  assert(!isDue(d, new Date("2026-11-18T20:59:00Z")));
  assert(isDue(d, new Date("2026-11-18T21:00:00Z")));
  d.papers = [{ date: "2026-11-19", theme: "A" }];
  assert(isDue(d, new Date("2026-11-19T09:00:00Z")));
  d.papers.push({ date: "2026-11-19", theme: "B" });
  assert(!isDue(d, new Date("2026-11-19T09:00:00Z")));
  d.schedule.enabled = false;
  assert(!isDue(d, new Date("2026-11-20T09:00:00Z")));
});
test("arXiv versions normalize and untrusted or future metadata is rejected", () => {
  assert.equal(
    canonicalId("https://arxiv.org/abs/2301.05387v12"),
    "2301.05387",
  );
  for (const s of [
    "../../x",
    "https://attacker.example/2301.05387",
    "2301.05387?token=x",
  ])
    assert.throws(() => canonicalId(s));
  const p = sample("A", "2301.05387");
  assert.throws(() =>
    validatePaper({ ...p, v1_date: "2099-01-01" }, "2026-11-19"),
  );
  assert.throws(() =>
    validatePaper(
      { ...p, url: "https://arxiv.org/abs/2301.00001" },
      "2026-11-19",
    ),
  );
});
function sample(theme, aid) {
  return {
    theme,
    arxiv_id: aid,
    url: "https://arxiv.org/abs/" + aid,
    title: "Verified source example",
    authors: "Example Author",
    summary: "Summary",
    background: "Background",
    method: "Method",
    results: "Results",
    relation: "Relation",
    recommend: "Recommend",
    note: "",
    v1_date: "2023-01-13",
    kind: "通常",
    figures: [],
    full_text_url: "",
  };
}
test("same-day reruns preserve existing recommendations and reader feedback", async (t) => {
  const dir = temp(t),
    v = new Vault(dir);
  v.initialize("test-password-123");
  const day = dateInZone(new Date(), "Asia/Tokyo");
  v.change((d) => {
    d.profile = buildProfile(answers);
    d.schedule.timezone = "Asia/Tokyo";
    d.papers.push({
      ...sample("A", "2301.05387"),
      id: day + "-1",
      date: day,
      order: 1,
      read: true,
      memo: "Keep my exact feedback",
    });
  });
  const original = v.data.papers[0];
  let calls = 0;
  const codex = {
    async run() {
      calls++;
      return { papers: [], report: "No sufficiently verified candidate." };
    },
    stop() {},
  };
  const r = new Research(v, codex);
  await r.generate({ manual: true });
  await r.job;
  assert.equal(calls, 1);
  assert.deepEqual(v.data.papers[0], original);
  v.change((d) =>
    d.papers.push({
      ...sample("B", "2611.06624"),
      date: day,
      id: day + "-2",
      order: 2,
    }),
  );
  assert((await r.generate({ manual: true })).alreadyComplete);
  assert.equal(calls, 1);
  v.close();
});
