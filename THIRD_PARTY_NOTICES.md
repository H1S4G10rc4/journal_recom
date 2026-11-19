# Third-party software

Paper Desk is an independent, local, open-source application. It is not an OpenAI product. OpenAI, ChatGPT, and Codex are trademarks of their respective owners.

- Codex CLI, `@openai/codex`, OpenAI: Apache-2.0. https://github.com/openai/codex
- Electron: MIT, with Chromium/Node.js and their third-party licenses. https://github.com/electron/electron
- MathJax: Apache-2.0. https://github.com/mathjax/MathJax
- sharp: Apache-2.0; packaged libvips is LGPL-3.0-or-later and retains its own notices. https://github.com/lovell/sharp
- resvg-js: MPL-2.0, with the resvg Rust stack and its bundled license notices. https://github.com/yisibl/resvg-js

Keep dependency license files and Electron's LICENSE/NOTICE files in the application distribution. The bundled Codex native vendor directory contains additional runtime licenses. It must remain intact. `resources/licenses/` holds additional copied upstream licenses.

Paper figures remain subject to their authors' licenses. No research papers or figures are included in the release. Downloaded original figures retain their source link and available license attribution. The MIT license for Paper Desk does not relicense them.

Reference for the original reading-workflow idea: https://note.com/john_doenote/n/nb514e544ce25
