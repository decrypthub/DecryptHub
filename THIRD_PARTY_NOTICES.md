# Third-party notices

DecryptHub is MIT licensed. Dependencies retain their own licenses; inspect installed package notices for the complete list.

- DeepSeek Harness: MIT, Copyright (c) 2026 DeepSeek. `sidecar/workspace-read.mjs` adapts the bounded streaming window algorithm from `packages/fs/tool-fs/src/read-render.ts`; `terminal-sanitize.mjs`, `terminal-buffer.mjs`, `pwsh-path.mjs` port the streaming sanitizer, retention buffer and PowerShell resolution from `terminal-bash/src/{sanitize,session}.ts` and `pwsh-local/src/resolve.ts`; `persistent-shell.mjs` adapts `tool-pwsh-persistent/src/index.ts`; `session-query-input.mjs` and `session-reference-uri.mjs` port `experimental/tool-session-query/src/input.ts` and `context/session-reference/src/uri.ts`. Reference commit: `ce7073d51254c26cd63b22a60835b8f948deb447`. Full notice: `docs/licenses/deepseek-harness-MIT.txt`.
- @earendil-works/pi-ai 1.3.0: MIT; the same catalog, native protocol and authentication SDK used by DeepSeek Harness. Its transitive SDKs retain their upstream licenses.
- Additional DeepSeek Harness MIT ports: `session-search-schema.mjs` is the type-erased SQLite schema; `session-search-sql.mjs` ports literal-phrase quoting, predicates, Unicode snippets, and candidate SQL from `packages/session-query/session-query-sqlite/src/{schema,query,index}.ts` at the reference commit above. The storage, writer-lease and history-repair modules adapt the upstream contracts to the desktop host; they do not claim binary compatibility with DSH session artifacts.
- Further DeepSeek Harness MIT ports: `history-zstd.mjs` ports the complete Zstandard frame scanner; `fs-win32.mjs` ports DACL/ReplaceFileW helpers with synchronous host loading; `terminal-inspection.mjs` ports POSIX process identities, foreground, stdin syscall inspection and signalling from `subprocess-local/src/process-inspector.ts`. Office skill assets in `resources/office-skills` and interpreter/library hashes in `resources/primary-runtime.lock.json` come from the same reference commit. Host migration, paging, export and runtime installation adapt the corresponding upstream behavior.
- @deepseek-ai/libreoffice-kit 0.1.5 and matching native engine: MPL-2.0 and bundled component terms; unmodified packages, NOTICE files and available source link are retained in Office resources. Source: https://github.com/deepseek-ai/dsh-libreoffice-kit .
- koffi 3.1.1: MIT; native file-security bindings. fflate 0.8.2: MIT; streamed ZIP export. chokidar 5.0.0: MIT; filesystem skill catalog invalidation.
- Bundled Python, pnpm and Python distributions retain their own licenses and notices in the primary runtime payload; pinned versions and source archive hashes are recorded in `resources/primary-runtime.lock.json` and `resources/pnpm-runtime.lock.json`.
- @vscode/ripgrep 1.18.0: MIT; packaged search helper. Distribution notices are retained in search resources.
- yaml 2.8.1: ISC; skill frontmatter parser.

- Tauri and plugins: MIT / Apache-2.0; desktop shell, dialogs and updates.
- React, Vite, Radix UI: MIT; user interface.
- xterm.js, @xterm/headless 6.0.0 and its fit addon: MIT; terminal rendering and headless protocol replies. License retained at `docs/licenses/xterm-MIT.txt`, from the installed xterm 6.0.0 package at the identical upstream commit `f447274f430fd22513f6adbf9862d19524471c04`.
- node-pty: MIT; terminal PTY worker. Its LICENSE and the bundled winpty LICENSE are retained in terminal resources. Windows ConPTY code and binaries retain their upstream terms.
- @modelcontextprotocol/sdk, ws, zod, yauzl: MIT; MCP, transport, schemas and archive parsing.
- @anthropic-ai/sandbox-runtime: Apache-2.0; optional execution isolation backend.
- Node.js / npm: their upstream licenses, included in the official downloaded Node runtime distribution.
- Patchright: Apache-2.0; development UI verification only. Not included in the core production payload.

WebDecryptHub is a separate optional component with its own third-party notices (including js-reverse-mcp). No CloakBrowser or Chromium binary is included in this repository or the core payload.
