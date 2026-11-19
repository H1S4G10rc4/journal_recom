import path from "node:path";
import { createWriteStream, readdirSync, statSync, existsSync } from "node:fs";
import { ZipFile } from "yazl";
import { finished } from "node:stream/promises";
const root = path.resolve(import.meta.dirname, "..");
const output = path.resolve(
  process.argv[2] || path.join(root, "..", "Paper-Desk-0.1.0-source.zip"),
);
const files = [
  "package.json",
  "package-lock.json",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "README.md",
  "RELEASE.md",
  ".gitignore",
  ".gitattributes",
  ".github",
  "src",
  "public",
  "test",
  "scripts",
  "resources/research-schema.json",
  "resources/icon.svg",
  "resources/nihongo",
];
const zip = new ZipFile();
const stream = createWriteStream(output);
zip.outputStream.pipe(stream);
function add(relative) {
  const absolute = path.join(root, relative);
  if (statSync(absolute).isDirectory()) {
    for (const name of readdirSync(absolute).sort()) add(relative + "/" + name);
  } else zip.addFile(absolute, "Paper-Desk/" + relative);
}
for (const relative of files) add(relative);
zip.end();
await finished(stream);
console.log(output);
