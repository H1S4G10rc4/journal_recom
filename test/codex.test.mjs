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
