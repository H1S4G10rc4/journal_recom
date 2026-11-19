import path from "node:path";
import os from "node:os";
import { createDesk } from "./server.mjs";
const state =
  process.env.PAPER_DESK_STATE ||
  path.join(os.homedir(), ".local/share/paper-desk-desktop");
const desk = await createDesk({ state, port: Number(process.env.PORT) || 0, browserAccess: true });
console.log(
  "Paper Desk browser URL:\n" + desk.origin,
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await desk.close();
    process.exit(0);
  });
