import { readFileSync } from "node:fs";
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const ref = process.env.GITHUB_REF || "";
if (ref.startsWith("refs/tags/") && ref !== "refs/tags/v" + version)
  throw Error("The release tag must match package.json: v" + version);
console.log("PaperCue " + version);
