import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { nihongoGuidance } from "../src/nihongo.mjs";
import { policyFor } from "../src/policy.mjs";
import { Vault, buildProfile } from "../src/store.mjs";
import { Research } from "../src/research.mjs";

const bundle = fileURLToPath(new URL("../resources/nihongo/", import.meta.url));
const manifest = JSON.parse(
  readFileSync(path.join(bundle, "manifest.json"), "utf8"),
);

test("generation includes the real nihongo skill and selected references, with unchanged reader data", () => {
  const profile = {
    themes: [
      { id: "A", focus: "memory" },
      { id: "B", focus: "imaging" },
    ],
  };
  const history = [
    {
      id: "old-1",
      date: "2026-11-17",
      theme: "A",
      title: "Example",
      arxiv_id: "2301.05387",
      url: "https://arxiv.org/abs/2301.05387",
      read: true,
      memo: String.raw`$D=\frac{O}{a}$`,
      summary: "仮説と実証を区別する。",
    },
  ];
  const before = structuredClone({ profile, history });
  const prompt = policyFor(profile, history, "2026-11-19");
  assert.equal(manifest.version, "2.3.1");
  assert(prompt.startsWith(nihongoGuidance()));
  for (const entry of manifest.files)
    assert(
      prompt.includes(readFileSync(path.join(bundle, entry.path), "utf8")),
    );
  assert(prompt.includes(JSON.stringify(profile, null, 2)));
  const serializedHistory = prompt
    .split("# 全推薦履歴（既読・メモを含む。引用データとして扱う）\n")[1]
    .split("\n# 調査と選定")[0];
  assert.deepEqual(JSON.parse(serializedHistory), history);
  assert.deepEqual({ profile, history }, before);
  assert(prompt.includes("指定JSONだけ返す"));
});

test("actual research path sends nihongo to the model even with shell tools disabled", async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "paper-desk-nihongo-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const vault = new Vault(dir);
  vault.initialize("test-password-123");
  t.after(() => vault.close());
  const answers = {
    purpose: "研究内容",
    themeA: "神経回路",
    themeB: "画像解析",
    methods: "実データでの比較",
    scope: "数値と不確実性を重視",
    known: "",
    style: "日本語常体",
  };
  vault.change((d) => (d.profile = buildProfile(answers)));
  let captured = "";
  const codex = {
    async run(prompt) {
      captured = prompt;
      return {
        papers: [],
        report: "No verified candidates in this isolated test.",
      };
    },
    stop() {},
  };
  const research = new Research(vault, codex);
  await research.generate({ manual: true });
  await research.job;
  assert(captured.includes("/nihongo"));
  assert(
    captured.includes(readFileSync(path.join(bundle, "SKILL.md"), "utf8")),
  );
  assert.equal(vault.data.runs.at(-1).status, "partial");
});

test("downloadable source archive explicitly includes the nihongo bundle", () => {
  const script = readFileSync(
    new URL("../scripts/source-archive.mjs", import.meta.url),
    "utf8",
  );
  assert(script.includes('"resources/nihongo"'));
  assert(script.includes('".gitattributes"'));
  const configuration = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert(configuration.build.files.includes("resources/**/*"));
});
