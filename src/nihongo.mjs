import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BUNDLE = fileURLToPath(new URL("../resources/nihongo/", import.meta.url));

export function nihongoGuidance() {
  const manifest = JSON.parse(
    readFileSync(path.join(BUNDLE, "manifest.json"), "utf8"),
  );
  const sections = [
    `# nihongo ${manifest.version} — Japanese research summaries`,
  ];
  for (const item of manifest.files) {
    const file = path.resolve(BUNDLE, item.path);
    if (!file.startsWith(BUNDLE)) throw Error("Invalid nihongo resource path");
    const data = readFileSync(file);
    if (createHash("sha256").update(data).digest("hex") !== item.sha256) {
      throw Error("nihongo resource checksum mismatch: " + item.path);
    }
    sections.push(`\n## ${item.path}\n${data.toString("utf8")}`);
  }
  sections.push(
    "\nApply /nihongo to the Japanese explanatory fields only. Preserve scientific meaning, TeX, evidence limits, and the required JSON schema. Return the final JSON only, without an editing report.",
  );
  return sections.join("\n");
}
