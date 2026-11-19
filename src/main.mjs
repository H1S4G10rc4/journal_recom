import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  shell,
  nativeImage,
  powerMonitor,
  dialog,
  session,
} from "electron";
import path from "node:path";
import os from "node:os";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDesk } from "./server.mjs";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
if (process.env.PAPER_DESK_STATE)
  app.setPath("userData", path.resolve(process.env.PAPER_DESK_STATE));
let win,
  tray,
  desk,
  quitting = false;
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
const external = (u) => {
  try {
    const x = new URL(u);
    if (x.protocol === "https:") shell.openExternal(x.href);
  } catch {}
};
function autostart() {
  try {
    if (process.platform === "linux") {
      const dir = path.join(os.homedir(), ".config/autostart");
      mkdirSync(dir, { recursive: true });
      const executable = process.env.APPIMAGE || app.getPath("exe");
      if (app.isPackaged) {
        const quoted = '"' + executable.replace(/[\\"`$]/g, "\\$&") + '"';
        writeFileSync(
          path.join(dir, "paper-desk.desktop"),
          "[Desktop Entry]\nType=Application\nName=PaperCue\nExec=" +
            quoted +
            " --hidden\nX-GNOME-Autostart-enabled=true\n",
          { mode: 0o600 },
        );
      }
    } else if (app.isPackaged)
      app.setLoginItemSettings({
        openAtLogin: true,
        openAsHidden: true,
        args: ["--hidden"],
      });
  } catch {}
}
function show() {
  if (win) {
    win.show();
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 1220,
    height: 880,
    minWidth: 780,
    minHeight: 640,
    title: "PaperCue",
    backgroundColor: "#f7f8f4",
    icon: path.join(ROOT, "resources/icon.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(({ url }) => {
    external(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== desk.origin) {
      event.preventDefault();
      external(url);
    }
  });
  win.on("close", (event) => {
    if (!quitting && tray) {
      event.preventDefault();
      win.hide();
    } else win = null;
  });
  win.loadURL(desk.launchURL());
}
if (gotLock) {
  app.on("second-instance", show);
  app.whenReady().then(async () => {
    try {
      if (process.argv.includes("--smoke-test")) {
        const { smokeTest } = await import("./smoke.mjs");
        await smokeTest();
        app.exit(0);
        return;
      }
      session.defaultSession.setPermissionRequestHandler(
        (_wc, _permission, callback) => callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      desk = await createDesk({
        state: app.getPath("userData"),
        mathjaxDir: app.isPackaged
          ? path.join(process.resourcesPath, "mathjax")
          : path.join(ROOT, "resources/mathjax"),
        onProfile: autostart,
      });
      const icon = nativeImage.createFromPath(
        path.join(ROOT, "resources/tray.png"),
      );
      try {
        tray = new Tray(icon);
        tray.setToolTip("PaperCue — 毎朝の研究論文");
        tray.setContextMenu(
          Menu.buildFromTemplate([
            { label: "PaperCueを開く", click: show },
            {
              label: "今日の推薦を更新",
              click: () => {
                if (desk.vault.unlocked && desk.vault.data.profile)
                  desk.research
                    .generate({ manual: true })
                    .catch((e) => dialog.showErrorBox("PaperCue", e.message));
                else show();
              },
            },
            { type: "separator" },
            { label: "終了", click: () => app.quit() },
          ]),
        );
        tray.on("click", show);
      } catch {}
      console.log("PaperCue ready on loopback.");
      powerMonitor.on("resume", () => desk.tick());
      if (!process.argv.includes("--hidden") || !desk.vault.initialized) show();
      else if (!desk.vault.unlocked) show();
    } catch (e) {
      if (process.argv.includes("--smoke-test")) {
        console.error("SMOKE FAIL", e);
        app.exit(1);
        return;
      }
      dialog.showErrorBox("PaperCueを起動できませんでした", e.message);
      app.quit();
    }
  });
}
app.on("window-all-closed", () => {
  if (!tray) app.quit();
});
app.on("activate", () => {
  if (desk) show();
});
app.on("before-quit", (event) => {
  if (!quitting && desk) {
    event.preventDefault();
    quitting = true;
    tray?.destroy();
    desk.close().finally(() => app.quit());
  }
});
