import { createHash } from "node:crypto";
import { createReadStream, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const directory = path.resolve(process.argv[2] || path.join(root, "release"));
const files = readdirSync(directory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.(AppImage|tar\.gz|exe|dmg|zip)$/.test(entry.name))
  .map((entry) => entry.name)
  .sort();
if (!files.length) throw Error("No release files found in " + directory);
const lines = [];
for (const name of files) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path.join(directory, name))) hash.update(chunk);
  lines.push(hash.digest("hex") + "  " + name);
}
const output = path.join(directory, "SHA256SUMS.txt");
writeFileSync(output, lines.join("\n") + "\n");
console.log(output);
