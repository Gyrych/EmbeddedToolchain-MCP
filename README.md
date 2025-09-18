# MCP Serialport Service

Lightweight MCP (Model Context Protocol) stdio server to access serial (COM) ports and ST‑Link tools for STM32 development.

This repository exposes a set of tools over JSON‑RPC via stdio (using `@modelcontextprotocol/sdk`) to perform common embedded development tasks from a client process: serial port I/O, ST‑Link flashing and debug helpers, project scaffolding and build invocation.

Supported features

- Serial port: `listPorts`, `openPort`, `write`, `read`, `closePort`

- ST‑Link: `st.listDevices`, `st.flashFirmware`, `st.readRegister`, `st.resetDevice`, `st.startDebug`, `st.stopDebug`, GDB helpers (`st.setBreakpoint`, `st.step`, `st.readVar`)

- Build: `compile` (supports `make` and STM32CubeIDE headless invocation)

- Project management: `createProject`, `getFileList`, `readFile`, `writeFile`, `gitCommit`, `gitDiff`

Quick start

Prerequisites:

- Node.js >= 18.18

- Platform-specific tools (for ST functionality): `st-info`, `st-flash`, `st-util` (open-source stm32 tools) or `ST-LINK_CLI.exe` (official ST tool). For building with CubeIDE, `stm32cubeide` may be required.

Install and run:

```bash
npm install
npm start
```

Environment variables (optional)

- `ST_LINK_CLI_PATH` — absolute path to `ST-LINK_CLI.exe`

- `ST_INFO_PATH` — path to `st-info`

- `ST_FLASH_PATH` — path to `st-flash`

- `ST_UTIL_PATH` — path to `st-util`

- `CUBEIDE_CLI` — path to `stm32cubeide` CLI

Usage: tools and examples

The server registers a number of tools (see code in `index.js`). Each tool accepts an object as input matching the tool's input schema and returns a structured result.

JSON‑RPC over stdio example (Node.js)

```javascript
// 示例：以子进程方式启动服务并发送一条简单的 JSON 消息（向 stdout 写回响应）
import { spawn } from 'node:child_process';

// 启动服务（假设在同一仓库目录）
const child = spawn(process.execPath, ['./index.js'], { stdio: ['pipe', 'pipe', 'inherit'] });

// 构造一个简单的 JSON-RPC-like 请求（注意：实际的 MCP framing 由 @modelcontextprotocol/sdk 管理，
// 这里演示最小文本协议示例以便快速测试）
const req = JSON.stringify({ jsonrpc: '2.0', method: 'listPorts', params: {}, id: 1 }) + '\n';

// 发送请求
child.stdin.write(req, 'utf8');

// 读取响应（演示目的）
child.stdout.on('data', (data) => {
  console.log('stdout:', data.toString());
});

// 结束时关闭 stdin
setTimeout(() => {
  child.stdin.end();
  child.kill();
}, 2000);
```

Note: For robust client implementations, prefer using an MCP client implementation compatible with `@modelcontextprotocol/sdk` rather than the simplified example above.

Serial example

1. Call `listPorts` to enumerate available COM ports.

2. Call `openPort` with `{ name: 'COM3', baudRate: 115200 }`.

3. Call `write` with `{ data: 'hello', encoding: 'utf8' }`.

4. Call `read` with optional `{ maxBytes, timeoutMs }`.

5. Call `closePort` when done.

ST‑Link example

- `st.listDevices()` — probes for available ST‑Link devices.

- `st.flashFirmware({ path: './build/app.bin', addr: '0x08000000' })` — flash the firmware (requires `st-flash` or `ST-LINK_CLI`).

- `st.startDebug({ port: 4242 })` — start `st-util` GDB server (keeps background process handle).

Build example

- Make: run `compile({ target: 'all', cwd: '/path/to/project', tool: 'make' })` (server runs `make` in the given `cwd`).

- STM32CubeIDE: run `compile({ tool: 'cubeide', cwd: <workspace>, project: <projectPath> })` — requires `CUBEIDE_CLI` detection.

Project scaffolding

Use `createProject({ template: 'bare', path: './myproj' })` to generate a minimal Makefile-based STM32 skeleton under `./myproj`.

Troubleshooting

- serialport native install failures: ensure your platform's native build tools or prebuilt binaries are available; on Windows prefer using prebuilt releases or install `windows-build-tools` when necessary.

- Permission denied opening COM port: ensure no other process holds the port and run with appropriate privileges.

- ST tools not found: install `st-flash`, `st-util` (from stm32 open-source tools) or configure `ST_LINK_CLI_PATH`.

Project progress (MVP status)

- Serial (`serial.js`): implemented — list/open/write/read/close; single active port model.

- ST‑Link (`stlink.js`): implemented core flows — device listing, flashing, read memory (via temporary file + `st-flash`), debug server; limitations: `writeRegister` unsupported via CLI (requires GDB scripting), some GDB‑monitor operations are MVP and may vary by `st-util` build.

- Compiler (`compiler.js`): implemented — `make` support and STM32CubeIDE CLI detection with headless command template.

- Project (`project.js`): implemented — `createProject` (bare template), file read/write, git helpers (`gitCommit`, `gitDiff`).

Contributing

Contributions are welcome. Please open issues or pull requests. Follow the repository style (ES modules, clear error messages). Note: this repository currently does not perform git operations itself when used as a library — the `git*` helpers shell out to `git`.

License

This project is released under the MIT License. See `LICENSE`.
