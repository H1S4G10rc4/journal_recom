import path from "node:path";
import { createWriteStream, readdirSync, statSync, mkdirSync, readFileSync } from "node:fs";
import { ZipFile } from "yazl";
import { finished } from "node:stream/promises";
const root = path.resolve(import.meta.dirname, "..");
const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const output = path.resolve(
  process.argv[2] || path.join(root, "release", `Paper-Desk-${version}-source.zip`),
);
const files = [
  "package.json",
  "package-lock.json",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "README.md",
  "RELEASE.md",
  "CHANGELOG.md",
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
  "resources/third-party",
];
mkdirSync(path.dirname(output), { recursive: true });
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
