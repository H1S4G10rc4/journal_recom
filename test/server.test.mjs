import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDesk } from "../src/server.mjs";
import { QUESTIONS } from "../src/store.mjs";
const fake = {
  async account() {
    return { signedIn: false, plan: null };
  },
  async login() {
    return { url: "https://auth.openai.com/test-only" };
  },
  async cancel() {},
  async logout() {},
  stop() {},
};
async function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "paper-desk-http-test-")),
    desk = await createDesk({ state: dir, codex: fake });
  t.after(async () => {
    await desk.close();
    rmSync(dir, { recursive: true, force: true });
  });
  let cookies = {};
  const base = desk.origin;
  const call = async (url, { body, method = "GET", headers = {} } = {}) => {
    const r = await fetch(base + url, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        Cookie: Object.entries(cookies)
          .map(([k, v]) => k + "=" + v)
          .join("; "),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    for (const c of r.headers.getSetCookie()) {
      const [k, v] = c.split(";")[0].split("=");
      cookies[k] = v;
    }
    return r;
  };
  return { desk, call, cookies };
}
test("localhost entry redirects to the canonical origin without relaxing API host checks", async (t) => {
  const { desk, call } = await fixture(t);
  const port = new URL(desk.origin).port;
  const host = "localhost:" + port;
  // fetch controls Host itself, so use HTTP directly to reproduce a browser alias.
  const request = (host, route = "/", method = "GET") => new Promise((resolve, reject) => {
    const req = http.request(desk.origin + route, { method, headers: { Host: host } }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
  const entry = await request(host, "/?preview=1");
  assert.equal(entry.status, 302);
  assert.equal(entry.headers.location, desk.origin + "/?preview=1");
  assert.equal(entry.headers["set-cookie"], undefined);
  assert.equal((await request(host, "/", "HEAD")).status, 302);
  assert.equal((await call("/")).status, 200);
  assert.equal((await request(host, "/api/state")).status, 403);
  assert.equal((await request(host, "/api/claim", "POST")).status, 403);
  for (const deniedHost of ["evil.example:" + port, "localhost.evil.example:" + port, "localhost:1"]) {
    assert.equal((await request(deniedHost)).status, 403);
  }
});

test("local capability and password protect all records; CSRF and DNS rebinding fail", async (t) => {
  const { desk, call } = await fixture(t);
  assert.equal((await call("/api/state")).status, 403);
  const launch = new URL(desk.launchURL()).hash.slice("#launch=".length);
  assert.equal(
    (await call("/api/claim", { method: "POST", body: { token: launch } }))
      .status,
    200,
  );
  assert.equal(
    (await call("/api/claim", { method: "POST", body: { token: launch } }))
      .status,
    200,
  );
  let state = await (await call("/api/state")).json();
  assert.equal(state.initialized, false);
  assert.equal((await call("/api/papers")).status, 401);
  assert.equal(
    (
      await call("/api/setup/password", {
        method: "POST",
        body: { password: "test-password-123" },
        headers: { Origin: "https://evil.example" },
      })
    ).status,
    403,
  );
  const wrongHost = await new Promise((resolve) => {
    http.get(
      desk.origin + "/api/state",
      { headers: { Host: "evil.example" } },
      (r) => {
        r.resume();
        resolve(r.statusCode);
      },
    );
  });
  assert.equal(wrongHost, 403);
  const r = await call("/api/setup/password", {
    method: "POST",
    body: { password: "test-password-123" },
  });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
  assert.equal((await call("/api/papers")).status, 200);
  assert.equal(
    (await call("/figures/" + "a".repeat(32) + ".webp")).status,
    404,
  );
  await call("/api/lock", { method: "POST", body: {} });
  assert.equal((await call("/api/export")).status, 401);
  assert.equal(
    (await call("/api/unlock", { method: "POST", body: { password: "wrong" } }))
      .status,
    400,
  );
  assert.equal(
    (
      await call("/api/unlock", {
        method: "POST",
        body: { password: "test-password-123" },
      })
    ).status,
    200,
  );
  assert.equal((await call("/static/%2e%2e/src/store.mjs")).status, 404);
});
test("natural-language answers, schedule, paper feedback persist; research fields are immutable", async (t) => {
  const { desk, call } = await fixture(t);
  await call("/api/claim", {
    method: "POST",
    body: { token: new URL(desk.launchURL()).hash.slice(8) },
  });
  await call("/api/setup/password", {
    method: "POST",
    body: { password: "test-password-123" },
  });
  const answers = Object.fromEntries(
    QUESTIONS.map((q) => [q.id, "自然言語で記入した回答：" + q.id]),
  );
  let r = await call("/api/setup/draft", {
    method: "POST",
    body: { answers, step: 3 },
  });
  assert.equal(r.status, 200);
  r = await call("/api/profile", {
    method: "POST",
    body: {
      answers,
      schedule: { time: "06:30", timezone: "Asia/Tokyo", enabled: true },
    },
  });
  assert.equal(r.status, 200);
  const s = await (await call("/api/state")).json();
  assert.equal(s.profile.themes.length, 2);
  assert.equal(s.profile.answers.scope, answers.scope);
  assert.equal(s.schedule.time, "06:30");
  desk.vault.change((d) =>
    d.papers.push({
      id: "2026-11-19-1",
      date: "2026-11-19",
      order: 1,
      title: "Original title",
      read: false,
      memo: "",
    }),
  );
  r = await call("/api/papers/2026-11-19-1", {
    method: "PATCH",
    body: { read: true, memo: "自分の研究で比較したい" },
  });
  assert.equal(r.status, 200);
  assert.equal(
    (
      await call("/api/papers/2026-11-19-1", {
        method: "PATCH",
        body: { title: "Overwrite" },
      })
    ).status,
    400,
  );
  const papers = await (await call("/api/papers")).json();
  assert.equal(papers.papers[0].title, "Original title");
  assert.equal(papers.papers[0].memo, "自分の研究で比較したい");
  assert.equal(papers.papers[0].read, true);
  assert(desk.vault.data.papers[0].readAt);
});


test("launch link survives browser previews and reuse without bypassing the password", async (t) => {
  const { desk, call, cookies } = await fixture(t);
  const launch = new URL(desk.launchURL()).hash.slice(8);
  await call("/api/claim", { method: "POST", body: { token: launch } });
  const clientCookie = cookies.pd_desktop_client;
  await call("/api/setup/password", { method: "POST", body: { password: "test-password-123" } });
  await call("/api/claim", { method: "POST", body: { token: launch } });
  assert.equal(cookies.pd_desktop_client, clientCookie);
  assert.equal((await call("/api/papers")).status, 200);
  const another = await fetch(desk.origin + "/api/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: launch }) });
  assert.equal(another.status, 200);
  const anotherCookie = another.headers.get("set-cookie").split(";")[0];
  const locked = await fetch(desk.origin + "/api/papers", { headers: { Cookie: anotherCookie } });
  assert.equal(locked.status, 401);
  const invalid = await fetch(desk.origin + "/api/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: "invalid-token" }) });
  assert.equal(invalid.status, 403);
});
