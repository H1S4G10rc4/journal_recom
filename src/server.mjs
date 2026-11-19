import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  Vault,
  QUESTIONS,
  buildProfile,
  validateSchedule,
  isDue,
  dateInZone,
} from "./store.mjs";
import { Codex } from "./codex.mjs";
import { Research } from "./research.mjs";
import { FigureCache } from "./figures.mjs";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};
const token = () => randomBytes(32).toString("hex");
function cookie(req, name) {
  return (
    req.headers.cookie
      ?.split(";")
      .map((s) => s.trim().split("="))
      .find(([k]) => k === name)?.[1] || ""
  );
}
export async function createDesk({
  state,
  port = 0,
  codex: providedCodex,
  onProfile,
  mathjaxDir,
  onOpenExternal,
  initialLaunchTokens = [],
  browserAccess = false,
} = {}) {
  const vault = new Vault(state),
    codex = providedCodex || new Codex(state),
    research = new Research(vault, codex);
  const clients = new Set(),
    sessions = new Map();
  let attempts = [],
    origin = "",
    closed = false;
  if (vault.unlocked)
    vault.change((d) => {
      for (const r of d.runs) if (r.status === "running") r.status = "error";
    });
  const launchTokens = new Set(
    initialLaunchTokens.filter((value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)),
  );
  const server = http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, origin);
    } catch {
      return reply(400, { error: "URLが不正です。" });
    }
    function reply(
      code,
      body,
      type = "application/json; charset=utf-8",
      extra = {},
    ) {
      if (res.writableEnded) return;
      if (!Buffer.isBuffer(body) && typeof body !== "string")
        body = JSON.stringify(body);
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
      res.writeHead(code, {
        "Content-Type": type,
        "Content-Length": buf.length,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        ...extra,
      });
      res.end(buf);
    }
    const json = (d, status = 200, extra = {}) =>
      reply(status, d, undefined, extra);
    const client = browserAccess || clients.has(cookie(req, "pd_desktop_client"));
    const authenticated =
      client &&
      vault.unlocked &&
      (sessions.get(cookie(req, "pd_desktop_session")) || 0) > Date.now();
    const localOrigin =
      (!req.headers.origin || req.headers.origin === origin) &&
      !["cross-site", "same-site"].includes(req.headers["sec-fetch-site"]);
    const body = async () => {
      let buf = "";
      for await (const chunk of req) {
        buf += chunk;
        if (Buffer.byteLength(buf) > 150000) throw Error("入力が長すぎます。");
      }
      const value = JSON.parse(buf || "{}");
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw Error("入力を確認してください。");
      return value;
    };
    const sessionHeaders = () => {
      const id = token();
      sessions.set(id, Date.now() + 30 * 86400000);
      return {
        "Set-Cookie": `pd_desktop_session=${id}; HttpOnly; SameSite=Strict; Path=/`,
      };
    };
    try {
      // Keep one cookie origin when a browser uses the localhost alias.
      // Only redirect the entry page; API requests still require the exact host.
      if (
        req.headers.host === "localhost:" + new URL(origin).port &&
        ["GET", "HEAD"].includes(req.method) &&
        url.pathname === "/"
      )
        return reply(302, "", "text/plain; charset=utf-8", {
          Location: origin + "/" + url.search,
        });
      if (req.headers.host !== new URL(origin).host)
        return json({ error: "この接続先は許可されていません。" }, 403);
      if (
        !localOrigin &&
        (url.pathname.startsWith("/api/") ||
          url.pathname.startsWith("/figures/"))
      )
        return json(
          { error: "別のページからの操作は許可されていません。" },
          403,
        );
      if (req.method === "POST" && url.pathname === "/api/claim") {
        const d = await body();
        if (!client && !launchTokens.has(d.token))
          return json({ error: "アプリから開き直してください。" }, 403);
        if (client) return json({ ok: true });
        const id = token();
        clients.add(id);
        return json({ ok: true }, 200, {
          "Set-Cookie": `pd_desktop_client=${id}; HttpOnly; SameSite=Strict; Path=/`,
        });
      }
      if (url.pathname.startsWith("/api/") && !client)
        return json({ error: "アプリから開き直してください。" }, 403);
      if (req.method === "GET" && url.pathname === "/api/state") {
        let account;
        try {
          account = await codex.account();
        } catch (e) {
          account = { signedIn: false, error: e.message };
        }
        return json({
          initialized: vault.initialized,
          unlocked: authenticated,
          account,
          questions: QUESTIONS,
          profile: authenticated ? vault.data.profile : null,
          draft: authenticated ? vault.data.draft : null,
          schedule: authenticated ? vault.data.schedule : null,
          research: authenticated ? research.status() : null,
        });
      }
      if (req.method === "POST" && url.pathname === "/api/auth/start") {
        if (vault.initialized && !authenticated)
          return json(
            { error: "先にパスワードでロックを解除してください。" },
            401,
          );
        return json(await codex.login());
      }
      if (req.method === "POST" && url.pathname === "/api/auth/cancel") {
        if (vault.initialized && !authenticated)
          return json({ error: "ロックを解除してください。" }, 401);
        await codex.cancel();
        return json({ ok: true });
      }
      if (
        req.method === "POST" &&
        ["/api/setup/password", "/api/unlock"].includes(url.pathname)
      ) {
        attempts = attempts.filter((t) => t > Date.now() - 600000);
        if (attempts.length >= 10)
          return json(
            { error: "試行回数が多すぎます。10分ほど待ってください。" },
            429,
          );
        attempts.push(Date.now());
        const d = await body();
        if (url.pathname === "/api/setup/password")
          vault.initialize(d.password);
        else vault.unlock(d.password);
        attempts = [];
        vault.change((data) => {
          for (const r of data.runs)
            if (r.status === "running" && !research.active) {
              r.status = "error";
              r.report = "前回の更新は完了前に終了しました。再実行できます。";
            }
        });
        json({ ok: true }, 200, sessionHeaders());
        return;
      }
      if (url.pathname.startsWith("/api/") && !authenticated)
        return json({ error: "パスワードでロックを解除してください。" }, 401);
      if (req.method === "POST" && url.pathname === "/api/lock") {
        sessions.delete(cookie(req, "pd_desktop_session"));
        return json({ ok: true }, 200, {
          "Set-Cookie":
            "pd_desktop_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        });
      }
      if (req.method === "POST" && url.pathname === "/api/auth/logout") {
        await codex.logout();
        return json({ ok: true });
      }
      if (req.method === "POST" && url.pathname === "/api/setup/draft") {
        const d = await body();
        if (
          !d.answers ||
          Object.keys(d.answers).some(
            (k) => !QUESTIONS.some((q) => q.id === k),
          ) ||
          Object.values(d.answers).some(
            (s) => typeof s !== "string" || s.length > 12000,
          )
        )
          throw Error("回答を確認してください。");
        vault.change(
          (x) =>
            (x.draft = {
              answers: d.answers,
              step: Math.max(
                0,
                Math.min(QUESTIONS.length, Number(d.step) || 0),
              ),
            }),
        );
        return json({ ok: true });
      }
      if (req.method === "POST" && url.pathname === "/api/profile") {
        if (research.active)
          throw Error("更新が終わってから設定を変更してください。");
        const d = await body();
        const p = buildProfile(d.answers),
          schedule = validateSchedule(d.schedule);
        vault.change((x) => {
          x.profile = p;
          x.schedule = schedule;
          x.draft = { answers: p.answers, step: 0 };
        });
        onProfile?.(p);
        const a = await codex.account().catch(() => ({ signedIn: false }));
        if (a.signedIn) await research.generate({ manual: true });
        return json({ ok: true });
      }
      if (req.method === "GET" && url.pathname === "/api/papers")
        return json({
          papers: [...vault.data.papers].sort(
            (a, b) => b.date.localeCompare(a.date) || a.order - b.order,
          ),
          today: dateInZone(new Date(), vault.data.schedule.timezone),
        });
      if (req.method === "GET" && url.pathname === "/api/export")
        return reply(
          200,
          JSON.stringify(
            {
              version: 1,
              profile: vault.data.profile,
              schedule: vault.data.schedule,
              papers: vault.data.papers,
            },
            null,
            2,
          ),
          "application/json; charset=utf-8",
          {
            "Content-Disposition":
              'attachment; filename="paper-desk-export.json"',
          },
        );
      if (req.method === "GET" && url.pathname === "/api/status")
        return json({ ...research.status(), schedule: vault.data.schedule });
      if (req.method === "POST" && url.pathname === "/api/generate")
        return json(await research.generate({ manual: true }), 202);
      if (req.method === "PATCH" && url.pathname.startsWith("/api/papers/")) {
        const d = await body();
        if (
          Object.keys(d).some((k) => !["read", "memo"].includes(k)) ||
          ("read" in d && typeof d.read !== "boolean") ||
          ("memo" in d && (typeof d.memo !== "string" || d.memo.length > 20000))
        )
          throw Error("更新内容を確認してください。");
        const id = url.pathname.slice("/api/papers/".length);
        let found = false;
        vault.change((x) => {
          const p = x.papers.find((p) => p.id === id);
          if (!p) return;
          found = true;
          if ("read" in d) {
            p.read = d.read;
            p.readAt = d.read ? new Date().toISOString() : "";
          }
          if ("memo" in d) p.memo = d.memo;
        });
        return json(
          found ? { ok: true } : { error: "論文が見つかりません。" },
          found ? 200 : 404,
        );
      }
      if (req.method === "GET" && url.pathname.startsWith("/figures/")) {
        if (!authenticated)
          return json({ error: "ロックを解除してください。" }, 401);
        const id = url.pathname.match(/^\/figures\/([a-f0-9]{32})\.webp$/)?.[1];
        if (!id) return json({ error: "見つかりません。" }, 404);
        try {
          return reply(
            200,
            new FigureCache(path.join(state, "figures"), vault.key).read(id),
            "image/webp",
          );
        } catch {
          return json({ error: "図が見つかりません。" }, 404);
        }
      }
      if (req.method === "GET") {
        let root = path.join(ROOT, "public"),
          name =
            url.pathname === "/"
              ? "index.html"
              : decodeURIComponent(url.pathname).replace(/^\/static\//, "");
        if (url.pathname.startsWith("/mathjax/")) {
          root = mathjaxDir || path.join(ROOT, "resources/mathjax");
          name = url.pathname.slice("/mathjax/".length);
        } else if (url.pathname !== "/" && !url.pathname.startsWith("/static/"))
          return json({ error: "見つかりません。" }, 404);
        const file = path.resolve(root, name);
        if (
          !file.startsWith(path.resolve(root) + path.sep) ||
          !existsSync(file) ||
          !statSync(file).isFile()
        )
          return json({ error: "見つかりません。" }, 404);
        return reply(
          200,
          readFileSync(file),
          TYPES[path.extname(file)] || "application/octet-stream",
        );
      }
      return json({ error: "見つかりません。" }, 404);
    } catch (e) {
      return json({ error: e.message || "処理できませんでした。" }, 400);
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  origin = "http://127.0.0.1:" + server.address().port;
  let checking = false;
  const tick = async () => {
    if (
      closed ||
      checking ||
      research.active ||
      !vault.unlocked ||
      !isDue(vault.data) ||
      Date.now() < research.nextRetry
    )
      return;
    checking = true;
    try {
      const a = await codex.account();
      if (a.signedIn) await research.generate();
    } catch {
    } finally {
      checking = false;
    }
  };
  const interval = setInterval(tick, 60000);
  interval.unref();
  return {
    server,
    origin,
    vault,
    codex,
    research,
    tick,
    launchURL() {
      const t = token();
      launchTokens.add(t);
      return origin + "/#launch=" + t;
    },
    async close() {
      closed = true;
      clearInterval(interval);
      await research.stop();
      codex.stop();
      vault.close();
      await new Promise((r) => server.close(r));
    },
  };
}
