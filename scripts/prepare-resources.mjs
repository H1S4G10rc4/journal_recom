import {
  cpSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
const root = path.resolve(import.meta.dirname, "..");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#2e5c47"/><path d="M132 132h172c32 0 52 20 52 50v198H184c-30 0-52-22-52-52V132Z" fill="#f2f6e9"/><path d="M184 132v248M219 205h97M219 245h97M219 285h65" stroke="#8fa781" stroke-width="13" stroke-linecap="round"/><circle cx="360" cy="353" r="43" fill="#b1c694"/></svg>`;
mkdirSync(path.join(root, "resources"), { recursive: true });
writeFileSync(path.join(root, "resources/icon.svg"), svg);
writeFileSync(
  path.join(root, "resources/icon.png"),
  new Resvg(svg).render().asPng(),
);
writeFileSync(
  path.join(root, "resources/tray.png"),
  new Resvg(svg, { fitTo: { mode: "width", value: 32 } }).render().asPng(),
);
const destination = path.join(root, "resources/mathjax/es5");
if (!existsSync(path.join(destination, "tex-svg-full.js")))
  cpSync(path.join(root, "node_modules/mathjax/es5"), destination, {
    recursive: true,
  });
// Keep the licenses of every runtime dependency in the source and installers.
const licenses = path.join(root, "resources/licenses");
mkdirSync(licenses, { recursive: true });
for (const name of ["noto-sans", "noto-sans-jp"]) {
  const source = path.join(root, "node_modules/@fontsource-variable", name);
  const output = path.join(root, "public/fonts", name);
  mkdirSync(path.join(output, "files"), { recursive: true });
  cpSync(path.join(source, "wght.css"), path.join(output, "wght.css"));
  for (const file of readdirSync(path.join(source, "files"))) {
    if (file.endsWith("-wght-normal.woff2"))
      cpSync(path.join(source, "files", file), path.join(output, "files", file));
  }
  cpSync(path.join(source, "LICENSE"), path.join(licenses, name + "-OFL.txt"));
}
for (const [pkg, name] of [
  ["electron", "Electron"],
  ["mathjax", "MathJax"],
  ["sharp", "sharp"],
  ["@resvg/resvg-js", "resvg"],
]) {
  for (const file of ["LICENSE", "LICENSE.txt", "LICENSE.md", "COPYING"]) {
    const p = path.join(root, "node_modules", pkg, file);
    if (existsSync(p)) {
      cpSync(p, path.join(licenses, name + "-" + file));
      break;
    }
  }
}
console.log(
  "Prepared local MathJax, native application icons, and runtime licenses.",
);
