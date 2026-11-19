import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

test("release checksums cover downloadable files and exclude directories and build logs", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "paper-desk-release-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const downloads = {
    "PaperCue-source.zip": Buffer.from("source archive fixture"),
    "PaperCue-windows-x64-setup.exe": Buffer.from([0, 1, 2, 255]),
    "PaperCue-linux-x64.tar.gz": Buffer.from("linux fixture"),
  };
  for (const [name, bytes] of Object.entries(downloads)) writeFileSync(path.join(dir, name), bytes);
  mkdirSync(path.join(dir, "unpacked.zip"));
  writeFileSync(path.join(dir, "builder-debug.yml"), "not a download");
  writeFileSync(path.join(dir, "SHA256SUMS.txt"), "stale checksum");
  const script = fileURLToPath(new URL("../scripts/release-checksums.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script, dir], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const actual = readFileSync(path.join(dir, "SHA256SUMS.txt"), "utf8");
  const expected = Object.keys(downloads).sort().map((name) =>
    createHash("sha256").update(downloads[name]).digest("hex") + "  " + name,
  ).join("\n") + "\n";
  assert.equal(actual, expected);
});
