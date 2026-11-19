import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { Codex } from "../src/codex.mjs";
test("research parses structured CLI events without writing private prompts/results to disk; tools stay restricted", async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "paper-desk-protocol-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let capturedArgs,
    prompt = "",
    capturedEnv;
  const spawnImpl = (_binary, args, options) => {
    capturedArgs = args;
    capturedEnv = options.env;
    const p = new EventEmitter();
    p.stdin = new PassThrough();
    p.stdout = new PassThrough();
    p.stderr = new PassThrough();
    p.stdin.on("data", (d) => (prompt += d));
    p.kill = () => {};
    setImmediate(() => {
      p.stdout.write(
        JSON.stringify({
          type: "item.completed",
          item: {
            type: "agent_message",
            text: JSON.stringify({
              papers: [],
              report: "PRIVATE_RESULT_MARKER",
            }),
          },
        }) + "\n",
      );
      p.stdout.end();
      setImmediate(() => p.emit("exit", 0));
    });
    return p;
  };
  const c = new Codex(dir, { binary: process.execPath, spawnImpl });
  c.account = async () => ({ signedIn: true });
  const result = await c.run("PRIVATE_RESEARCH_MARKER", { type: "object" });
  assert.equal(result.report, "PRIVATE_RESULT_MARKER");
  assert.equal(prompt, "PRIVATE_RESEARCH_MARKER");
  assert(capturedArgs.includes("--json"));
  assert(capturedArgs.includes("read-only"));
  assert(capturedArgs.includes("shell_tool"));
  assert(capturedArgs.includes("--ignore-user-config"));
  assert(capturedArgs.includes('cli_auth_credentials_store="auto"'));
  assert(!capturedArgs.includes("-o"));
  assert.equal(capturedEnv.CODEX_HOME, path.join(dir, "codex"));
  const job = path.join(
    dir,
    "research",
    readdirSync(path.join(dir, "research"))[0],
  );
  for (const f of readdirSync(job)) {
    const data = readFileSync(path.join(job, f), "utf8");
    assert(!data.includes("PRIVATE_RESEARCH_MARKER"));
    assert(!data.includes("PRIVATE_RESULT_MARKER"));
  }
});

test("login and research use the same credential store even when exec ignores user config", async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "paper-desk-login-store-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let capturedArgs;
  const spawnImpl = (_binary, args) => {
    capturedArgs = args;
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    child.stdin.on("data", (data) => {
      const message = JSON.parse(String(data));
      if (message.id !== undefined)
        setImmediate(() => child.stdout.write(JSON.stringify({ id: message.id, result: {} }) + "\n"));
    });
    return child;
  };
  const c = new Codex(dir, { binary: process.execPath, spawnImpl });
  t.after(() => c.stop());
  await c.connect();
  assert(capturedArgs.includes("app-server"));
  assert(capturedArgs.includes('cli_auth_credentials_store="auto"'));
});

for (const [message, expected] of [
  ["401 Unauthorized: Missing bearer authentication PRIVATE_SECRET", /認証情報を読み込めませんでした/],
  ["usage_limit_reached PRIVATE_SECRET", /利用上限に達しました/],
  ["2026-11-19T06:06:34.401429Z unexpected disconnect PRIVATE_SECRET", /調査処理が完了しませんでした/],
]) {
  test("structured failure is actionable without exposing diagnostics: " + expected.source, async (t) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "paper-desk-error-test-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const spawnImpl = () => {
      const child = new EventEmitter();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => {};
      child.stdin.on("finish", () => {
        child.stdout.end(JSON.stringify({ type: "turn.failed", error: { message } }) + "\n");
        setImmediate(() => child.emit("exit", 1));
      });
      return child;
    };
    const c = new Codex(dir, { binary: process.execPath, spawnImpl });
    c.account = async () => ({ signedIn: true });
    await assert.rejects(c.run("PRIVATE_PROMPT", { type: "object" }), (e) => {
      assert.match(e.message, expected);
      assert(!e.message.includes("PRIVATE_SECRET"));
      return true;
    });
  });
}
