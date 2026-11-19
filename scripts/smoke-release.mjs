import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const output = path.resolve(process.argv[2] || "release");
const platform = process.platform;
let executable;
if (platform === "linux") {
  executable = path.join(output, "linux-unpacked", "asa-papers");
} else if (platform === "win32") {
  executable = path.join(output, "win-unpacked", "asa-papers.exe");
} else if (platform === "darwin") {
  const folder = path.join(output, "mac-arm64", "asa-papers.app", "Contents", "MacOS");
  executable = path.join(folder, "asa-papers");
}
if (!executable || !existsSync(executable)) throw Error("Packaged Asa Papers executable not found");

const state = mkdtempSync(path.join(os.tmpdir(), "paper-desk-release-"));
try {
  const result = spawnSync(executable, ["--smoke-test"], {
    env: { ...process.env, PAPER_DESK_STATE: state },
    stdio: "inherit",
    timeout: 60000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error("Packaged app failed: " + (result.status ?? result.signal));
} finally {
  rmSync(state, { recursive: true, force: true, maxRetries: 5 });
}
