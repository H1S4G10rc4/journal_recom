import { createHash, randomBytes } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  renameSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { Resvg } from "@resvg/resvg-js";
const HOSTS = new Set([
  "arxiv.org",
  "www.arxiv.org",
  "export.arxiv.org",
  "ar5iv.labs.arxiv.org",
  "ar5iv.org",
]);
export function safeSource(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw Error("原図URLが不正です。");
  }
  if (
    u.protocol !== "https:" ||
    !HOSTS.has(u.hostname) ||
    u.username ||
    u.password ||
    u.port
  )
    throw Error("arXiv以外の図は取得しません。");
  return u;
}
export async function limitedFetch(
  raw,
  { max = 25_000_000, fetcher = fetch } = {},
) {
  let u = safeSource(raw);
  for (let n = 0; n < 5; n++) {
    const r = await fetcher(u, {
      redirect: "manual",
      signal: AbortSignal.timeout(45000),
    });
    if (r.status >= 300 && r.status < 400) {
      u = safeSource(new URL(r.headers.get("location"), u));
      await r.body?.cancel();
      continue;
    }
    if (!r.ok) {
      await r.body?.cancel();
      throw Error(`原図取得 HTTP ${r.status}`);
    }
    const parts = [];
    let count = 0;
    for await (const p of r.body) {
      count += p.length;
      if (count > max) {
        await r.body.cancel().catch(() => {});
        throw Error("画像が大きすぎます。");
      }
      parts.push(p);
    }
    return {
      data: Buffer.concat(parts),
      type: r.headers.get("content-type") || "",
      url: u.href,
    };
  }
  throw Error("転送が多すぎます。");
}
export function sanitizeSVG(raw) {
  const s = raw.toString("utf8");
  if (
    /<!DOCTYPE|<!ENTITY|<\s*(?:script|foreignObject)\b|\bon\w+\s*=|\bxml:base\s*=|@import/i.test(
      s,
    )
  )
    throw Error("安全に表示できないSVGです。");
  for (const m of s.matchAll(/\b(?:xlink:)?href\s*=\s*['"]([^'"]*)['"]/gi)) {
    if (
      !m[1].startsWith("#") &&
      !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/.test(m[1])
    )
      throw Error("外部参照を含むSVGです。");
  }
  for (const m of s.matchAll(/url\(\s*['"]?([^\)'"\s]+)/gi)) {
    if (!m[1].startsWith("#")) throw Error("外部スタイルを含むSVGです。");
  }
  return s;
}
const plain = (s) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
export function figuresFromHTML(html, base) {
  safeSource(base);
  const baseHref = html.match(/<base\b[^>]*href=["']([^"']+)["']/i)?.[1];
  const assetBase = baseHref
    ? new URL(baseHref, base).href
    : base.split("#")[0];
  safeSource(assetBase);
  const out = [];
  for (const m of html.matchAll(/<figure\b([^>]*)>([\s\S]*?)<\/figure>/gi)) {
    const body = m[2],
      image = body.match(
        /<(?:img|object)\b[^>]*(?:src|data)\s*=\s*["']([^"']+)["']/i,
      );
    if (!image) continue;
    const sourceId = m[1].match(/\bid=["']([^"']+)["']/)?.[1] || "";
    let imageUrl;
    try {
      imageUrl = safeSource(
        new URL(image[1].replace(/&amp;/g, "&"), assetBase),
      ).href;
    } catch {
      continue;
    }
    const caption = plain(
      body.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i)?.[1] || "",
    );
    out.push({
      image_url: imageUrl,
      source_url: base.split("#")[0] + (sourceId ? "#" + sourceId : ""),
      label:
        caption.match(/(?:Figure|Fig\.)\s*\d+/i)?.[0] ||
        `Figure ${out.length + 1}`,
      caption: "原文の図。本文の説明とあわせて参照。",
      originalCaption: caption.slice(0, 1200),
      license: "ライセンス未確認。原文の表示を参照。",
    });
    if (out.length === 2) break;
  }
  return out;
}
export class FigureCache {
  constructor(dir, key) {
    this.dir = dir;
    this.key = key;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  async paper(paper) {
    let figs = Array.isArray(paper.figures) ? paper.figures.slice(0, 2) : [],
      warnings = [];
    if (!figs.length) {
      const urls = [
        paper.full_text_url,
        `https://arxiv.org/html/${paper.arxiv_id}`,
        `https://ar5iv.labs.arxiv.org/html/${paper.arxiv_id}`,
      ].filter(Boolean);
      for (const url of [...new Set(urls)]) {
        try {
          const d = await limitedFetch(url, { max: 8_000_000 });
          figs = figuresFromHTML(d.data.toString("utf8"), d.url);
          if (figs.length) break;
        } catch {}
      }
    }
    const saved = [];
    for (const f of figs) {
      try {
        const { data, type } = await limitedFetch(f.image_url);
        let raster = data;
        if (
          /svg/i.test(type) ||
          /^\s*(?:<\?xml[^>]*>\s*)?<svg/i.test(data.toString("utf8", 0, 200))
        ) {
          raster = Buffer.from(
            new Resvg(sanitizeSVG(data), {
              fitTo: { mode: "width", value: 2200 },
              font: { loadSystemFonts: true },
            })
              .render()
              .asPng(),
          );
        }
        const image = sharp(raster, { limitInputPixels: 50_000_000 });
        const converted = await image
          .flatten({ background: "#ffffff" })
          .resize({
            width: 2200,
            height: 2200,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: 92 })
          .toBuffer();
        const id = createHash("sha256")
          .update(paper.arxiv_id + f.image_url)
          .digest("hex")
          .slice(0, 32);
        this.write(id, converted);
        saved.push({
          ...f,
          local_url: "/figures/" + id + ".webp",
          processing:
            "原図を表示用に縮小・形式変換。データ、軸、ラベルは変更していない。",
        });
      } catch (e) {
        warnings.push(`${f.label || "図"}：${e.message}`);
      }
    }
    return { figures: saved, warnings };
  }
  write(id, data) {
    const { createCipheriv } = requireCrypto;
    const iv = randomBytes(12),
      c = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([c.update(data), c.final()]);
    const temp = path.join(this.dir, id + ".tmp");
    writeFileSync(temp, Buffer.concat([iv, c.getAuthTag(), encrypted]), {
      mode: 0o600,
    });
    renameSync(temp, path.join(this.dir, id + ".enc"));
  }
  read(id) {
    if (!/^[a-f0-9]{32}$/.test(id)) throw Error("図が見つかりません。");
    const raw = readFileSync(path.join(this.dir, id + ".enc"));
    const d = requireCrypto.createDecipheriv(
      "aes-256-gcm",
      this.key,
      raw.subarray(0, 12),
    );
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]);
  }
}
import * as requireCrypto from "node:crypto";
