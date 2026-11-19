import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dateInZone, canonicalId } from "./store.mjs";
import { policyFor } from "./policy.mjs";
import { FigureCache } from "./figures.mjs";
import path from "node:path";
const schema = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../resources/research-schema.json", import.meta.url),
    ),
    "utf8",
  ),
);
export function validatePaper(input, day) {
  const p = structuredClone(input);
  for (const k of [
    "title",
    "authors",
    "summary",
    "background",
    "method",
    "results",
    "relation",
    "recommend",
  ])
    if (typeof p[k] !== "string" || !p[k].trim() || p[k].length > 50000)
      throw Error("論文データが不完全です：" + k);
  if (!["A", "B"].includes(p.theme)) throw Error("テーマが不正です。");
  p.arxiv_id = canonicalId(p.arxiv_id);
  if (canonicalId(p.url) !== p.arxiv_id)
    throw Error("arXiv IDとURLが一致しません。");
  p.url = "https://arxiv.org/abs/" + p.arxiv_id;
  if (p.v1_date) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(p.v1_date) ||
      !Number.isFinite(Date.parse(p.v1_date)) ||
      p.v1_date > day
    )
      throw Error("初回投稿日を確認できません。");
    if (
      p.kind === "新着" &&
      Date.parse(day) - Date.parse(p.v1_date) > 31 * 86400000
    )
      p.kind = "通常";
  } else if (p.kind === "新着") p.kind = "通常";
  return p;
}
export class Research {
  constructor(vault, codex) {
    this.vault = vault;
    this.codex = codex;
    this.active = false;
    this.nextRetry = 0;
    this.retryCount = 0;
  }
  status() {
    return {
      running: this.active,
      run: this.vault.unlocked ? this.vault.data.runs.at(-1) || null : null,
    };
  }
  async generate({ manual = false } = {}) {
    const v = this.vault;
    if (this.active) return { alreadyRunning: true };
    if (!v.unlocked || !v.data.profile)
      throw Error("初回設定を完了してください。");
    const day = dateInZone(new Date(), v.data.schedule.timezone);
    if (
      v.data.profile.themes.every((t) =>
        v.data.papers.some((p) => p.date === day && p.theme === t.id),
      )
    )
      return { alreadyComplete: true };
    if (!manual && Date.now() < this.nextRetry) return { retryLater: true };
    if (manual) this.retryCount = 0;
    this.active = true;
    const id = Date.now().toString();
    v.change((d) => {
      d.runs.push({
        id,
        date: day,
        started: new Date().toISOString(),
        status: "running",
        report: "候補を探し、書誌情報と本文を確認しています。",
      });
      d.runs = d.runs.slice(-100);
    });
    const job = this.work(id, day).finally(() => (this.active = false));
    this.job = job;
    job.catch(() => {});
    return { started: true };
  }
  async work(id, day) {
    const v = this.vault;
    try {
      const result = await this.codex.run(
        policyFor(v.data.profile, v.data.papers, day),
        schema,
      );
      if (!result || !Array.isArray(result.papers) || result.papers.length > 2)
        throw Error("調査結果の形式が不正です。");
      let added = 0;
      const warnings = [];
      const cache = new FigureCache(path.join(v.dir, "figures"), v.key);
      for (const input of result.papers) {
        const p = validatePaper(input, day);
        if (
          v.data.papers.some(
            (x) =>
              x.arxiv_id === p.arxiv_id ||
              (x.date === day && x.theme === p.theme),
          )
        )
          continue;
        const f = await cache.paper(p);
        p.figures = f.figures;
        if (f.warnings.length)
          warnings.push(p.title + "：" + f.warnings.join(" / "));
        if (!p.figures.length)
          p.note = (p.note || "") + "\n図は取得できなかった。原文を参照。";
        v.change((d) => {
          const used = new Set(
            d.papers.filter((x) => x.date === day).map((x) => x.order),
          );
          const order = [1, 2].find((n) => !used.has(n));
          if (
            !order ||
            d.papers.some(
              (x) =>
                x.arxiv_id === p.arxiv_id ||
                (x.date === day && x.theme === p.theme),
            )
          )
            return;
          d.papers.push({
            ...p,
            id: day + "-" + order,
            date: day,
            order,
            read: false,
            readAt: "",
            memo: "",
          });
          added++;
        });
      }
      const complete = v.data.profile.themes.every((t) =>
        v.data.papers.some((p) => p.date === day && p.theme === t.id),
      );
      v.change((d) => {
        const r = d.runs.find((x) => x.id === id);
        Object.assign(r, {
          status: complete ? "complete" : "partial",
          finished: new Date().toISOString(),
          report:
            String(result.report || "") +
            "\n保存と再読み込みの確認：" +
            added +
            "本。" +
            (warnings.length ? "\n図の取得記録：\n" + warnings.join("\n") : ""),
        });
      });
      this.retryCount = 0;
      this.nextRetry = Date.now() + (complete ? 0 : 4 * 3600000);
    } catch (e) {
      v.change((d) => {
        const r = d.runs.find((x) => x.id === id);
        Object.assign(r, {
          status: "error",
          finished: new Date().toISOString(),
          report: e.message,
        });
      });
      this.retryCount++;
      this.nextRetry =
        Date.now() + (this.retryCount >= 3 ? 4 * 3600000 : 15 * 60000);
      throw e;
    }
  }
  async stop() {
    this.codex.stop();
    if (this.job) await this.job.catch(() => {});
  }
}
