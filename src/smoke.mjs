import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";
import sharp from "sharp";
import { Resvg } from "@resvg/resvg-js";
import { createDesk } from "./server.mjs";
import { nihongoGuidance } from "./nihongo.mjs";

export async function smokeTest() {
  const state = mkdtempSync(path.join(os.tmpdir(), "paper-desk-smoke-"));
  let desk, window;
  try {
    desk = await createDesk({
      state,
      mathjaxDir: app.isPackaged
        ? path.join(process.resourcesPath, "mathjax")
        : fileURLToPath(new URL("../resources/mathjax/", import.meta.url)),
    });
    assert.equal((await desk.codex.account()).signedIn, false);
    assert(nihongoGuidance().length > 0);

    const png = new Resvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="green"/></svg>',
    ).render().asPng();
    const image = await sharp(png).webp().toBuffer({ resolveWithObject: true });
    assert.equal(image.info.format, "webp");
    assert.equal(image.info.width, 16);

    window = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true },
    });
    await window.loadURL(desk.launchURL());
    const rendered = await window.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          observer.disconnect();
          reject(new Error("The setup screen did not render"));
        }, 15000);
        const check = async () => {
          if (!document.querySelector("#connect")) return;
          observer.disconnect();
          try {
            const latin = await document.fonts.load('500 16px "Noto Sans Variable"', "PaperCue");
            const japanese = await document.fonts.load('500 16px "Noto Sans JP Variable"', "論文");
            resolve(latin.length > 0 && japanese.length > 0 && document.title === "PaperCue" && Boolean(window.MathJax?.startup));
          } catch (error) {
            reject(error);
          } finally {
            clearTimeout(timeout);
          }
        };
        const observer = new MutationObserver(check);
        observer.observe(document.body, { childList: true, subtree: true });
        check();
      })
    `);
    assert(rendered, "The bundled Noto fonts and MathJax must load");
    const notices = await window.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const body = document.querySelector("#oss-text");
        const timeout = setTimeout(() => {
          observer.disconnect();
          reject(new Error("The license notices did not render"));
        }, 8000);
        const observer = new MutationObserver(() => {
          if (!body.textContent.includes("# オープンソースライセンスと出典")) return;
          const select = document.querySelector("#oss-select");
          const names = Array.from(select.options, (option) => option.textContent);
          observer.disconnect();
          clearTimeout(timeout);
          resolve(document.querySelector("#oss-dialog").open && names.includes("Codex-NOTICE") &&
            names.includes("libvips-LICENSE") && names.includes("LGPL-3.0.txt") &&
            names.includes("GPL-3.0.txt") && names.includes("noto-sans-jp-OFL.txt"));
        });
        observer.observe(body, { childList: true, subtree: true });
        document.querySelector("#open-oss").click();
      })
    `);
    assert(notices, "The app must display the bundled license texts");
  } finally {
    // Stop the renderer's polling before waiting for the HTTP server to close.
    if (window && !window.isDestroyed()) window.destroy();
    desk?.server.closeAllConnections();
    await desk?.close();
    rmSync(state, { recursive: true, force: true, maxRetries: 5 });
  }
  console.log("SMOKE PASS: setup screen, fonts, licenses, MathJax, Codex, image conversion and nihongo");
}
