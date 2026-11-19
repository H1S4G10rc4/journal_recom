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
            const latin = await document.fonts.load('500 16px "Noto Sans Variable"', "Paper Desk");
            const japanese = await document.fonts.load('500 16px "Noto Sans JP Variable"', "論文");
            resolve(latin.length > 0 && japanese.length > 0 && Boolean(window.MathJax?.startup));
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
    console.log("SMOKE PASS: setup screen, Noto fonts, MathJax, Codex, image conversion and nihongo");
  } finally {
    // The smoke window must not trigger the normal last-window quit handler.
    await desk?.close();
    rmSync(state, { recursive: true, force: true, maxRetries: 5 });
  }
}
