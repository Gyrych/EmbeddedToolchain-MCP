<!--
  Auto-updated README - English
  Purpose: provide clear installation, usage and examples for end users.
-->

# MCP Serialport Service

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) [![node](https://img.shields.io/badge/node-%3E%3D18.18-brightgreen)](https://nodejs.org/) [![status](https://img.shields.io/badge/status--placeholder-lightgrey)](#)

Lightweight MCP (Model Context Protocol) stdio server exposing serial (COM) ports and ST‑Link helper tools for STM32 development.

This repository registers a set of JSON‑RPC tools over stdio (via `@modelcontextprotocol/sdk`) so that a client process can drive common embedded development tasks: serial I/O, ST‑Link flashing and debug helpers, project scaffolding, and build invocation.

Key features

- **Serial port**: `listPorts`, `openPort`, `write`, `read`, `closePort`
- **ST‑Link**: `st.listDevices`, `st.flashFirmware`, `st.readRegister`, `st.resetDevice`, `st.startDebug`, `st.stopDebug`
- **GDB helpers (experimental)**: `st.setBreakpoint`, `st.step`, `st.readVar` (behavior depends on st-util/GDB compatibility)
- **Build**: `compile` (supports `make` and STM32CubeIDE headless invocation)
- **Project management**: `createProject`, `getFileList`, `readFile`, `writeFile`, `gitCommit`, `gitDiff`

Prerequisites

- Node.js >= 18.18
- Optional platform tools for ST functionality: `st-info`, `st-flash`, `st-util` (open-source stm32 tools) or `ST-LINK_CLI.exe` (official ST tool). For CubeIDE headless builds, a `stm32cubeide` CLI may be required.

Quick start

Install dependencies and start the server:

```bash
npm install
npm start
```

Available npm scripts

- `npm start` — run the service (`node ./index.js`)
- `npm run check` — runtime dependency quick-check (attempts to import `@modelcontextprotocol/sdk` and `serialport`)

Environment variables (optional)

- `ST_LINK_CLI_PATH` — absolute path to `ST-LINK_CLI.exe`
- `ST_INFO_PATH` — path to `st-info`
- `ST_FLASH_PATH` — path to `st-flash`
- `ST_UTIL_PATH` — path to `st-util`
- `CUBEIDE_CLI` — path to `stm32cubeide` CLI
- `OPENOCD_PATH` — path to `openocd` executable (optional)
- `JLINK_EXE_PATH` — path to `JLinkExe`/`JLink.exe` (optional)
- `JLINK_GDB_SERVER_PATH` — path to `JLinkGDBServerCL.exe` (optional)

Usage and examples

The server registers tools in `index.js`. Each tool expects an object matching its input schema and returns a structured result. Prefer using a proper MCP client (via `@modelcontextprotocol/sdk`) for production clients; the examples below show minimal testing patterns.

Node child_process example (quick test)

> **Note:** This minimal example is for quick manual testing only — the MCP SDK expects framed messages and a proper MCP client. For production use, use an MCP client from `@modelcontextprotocol/sdk`.

```javascript
// Minimal test: spawn the service and send a JSON-RPC-like request over stdin
import { spawn } from 'node:child_process';

const child = spawn(process.execPath, ['./index.js'], { stdio: ['pipe', 'pipe', 'inherit'] });

const req = JSON.stringify({ jsonrpc: '2.0', method: 'listPorts', params: {}, id: 1 }) + '\n';
child.stdin.write(req, 'utf8');

child.stdout.on('data', (data) => {
  console.log('stdout:', data.toString());
});

setTimeout(() => {
  child.stdin.end();
  child.kill();
}, 2000);
```

Serial usage (conceptual)

1. Call `listPorts` to enumerate COM ports.
2. Call `openPort` with `{ name: 'COM3', baudRate: 115200 }`.
3. Call `write` with `{ data: 'hello', encoding: 'utf8' }`.
4. Call `read` with optional `{ maxBytes, timeoutMs }`.
5. Call `closePort` when finished.

ST‑Link examples

- `st.listDevices()` — probe for ST‑Link devices.
- `st.flashFirmware({ path: './build/app.bin', addr: '0x08000000' })` — flash firmware (requires `st-flash`, `ST-LINK_CLI`, or `STM32_Programmer_CLI`).
- `st.startDebug({ port: 4242 })` — start `st-util` GDB server (starts a background debug server and returns a status message; the process handle is kept internally and is not returned).

Compile example

- Make: `compile({ target: 'all', cwd: '/path/to/project', tool: 'make' })` — runs `make` in `cwd`.
- STM32CubeIDE: `compile({ tool: 'cubeide', cwd: <workspace>, project: <projectPath> })` — requires `CUBEIDE_CLI`.

Project scaffolding

Use `createProject({ template: 'bare', path: './myproj' })` to generate a minimal Makefile-based STM32 skeleton.

OpenOCD and J-Link

This project also exposes OpenOCD- and SEGGER J-Link-based operations via `openocd.js` and `jlink.js`:

- **OpenOCD** (defaults to port 3333): `ocd.startDebug`, `ocd.stopDebug`, `ocd.flashFirmware`, `ocd.resetDevice`, `ocd.readRegister`, `ocd.version`.
- **J-Link** (defaults to port 2331): `jlink.startDebug`, `jlink.stopDebug`, `jlink.flashFirmware`, `jlink.resetDevice`, `jlink.readRegister`, `jlink.version`.

Example: start OpenOCD debug server

```js
// Start openocd with interface/target (returns status message)
await mcp.call('ocd.startDebug', { interface: 'stlink', target: 'stm32f4x', port: 3333 });
```

Example: start J-Link GDB server

```js
// Start JLinkGDBServerCL (returns status message)
await mcp.call('jlink.startDebug', { device: 'STM32F407VG', if: 'SWD', port: 2331 });
```

Example: flash with OpenOCD

```js
await mcp.call('ocd.flashFirmware', { path: './build/app.bin', interface: 'stlink', target: 'stm32f4x' });
```

Example: flash with J-Link Commander

```js
await mcp.call('jlink.flashFirmware', { path: './build/app.bin', device: 'STM32F407VG', if: 'SWD', addr: '0x08000000' });
```

Notes and troubleshooting for OpenOCD / J-Link

- Ensure the CLI tools are installed and reachable via the environment variables above or your PATH.
- Default GDB ports: OpenOCD uses 3333, J-Link uses 2331 unless overridden.
- `ocd.readRegister` / `jlink.readRegister` implementations may write temporary files or print ASCII memory output; results are returned as byte arrays or textual output respectively.
- If startDebug fails, check that the chosen interface/target and configuration files exist and that no other process is listening on the GDB port.
- On Windows, provide explicit absolute paths via `OPENOCD_PATH`, `JLINK_EXE_PATH` or `JLINK_GDB_SERVER_PATH` if executables are not on PATH.

Troubleshooting

- `serialport` native install issues: ensure build tools or prebuilt binaries are available on Windows; use prebuilt releases when possible.
- Permission denied opening COM port: check for other processes using the port and run with appropriate privileges.
- ST tools not found: install `st-flash`, `st-util` (open-source), `STM32_Programmer_CLI`, or configure `ST_LINK_CLI_PATH`.

- `st.writeRegister` limitation: `st.writeRegister` is registered but not supported via simple CLI flows and will return an error unless performed inside a GDB debug session. Use `st.startDebug` + GDB for register writes.

Project status (MVP)

- `serial.js`: list/open/write/read/close implemented (single active port model).
- `stlink.js`: device listing, flashing, reading memory, and debug server implemented; some GDB features are MVP and may depend on `st-util` build.
- `compiler.js`: supports `make` and detection/templating for STM32CubeIDE headless commands.
- `project.js`: `createProject`, file operations, and git helper shell-outs implemented.

Contributing

Contributions are welcome. Open issues or pull requests. Follow ES module style and write clear error messages. Note: git helpers shell out to `git`; this repo itself will not perform git operations automatically.

License

This project is licensed under the MIT License. See `LICENSE`.
