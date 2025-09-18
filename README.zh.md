# MCP Serialport 服务

轻量级 MCP（Model Context Protocol）stdio 服务，用于在 STM32 开发流程中通过 JSON‑RPC 访问串口（COM）和 ST‑Link 工具。

本仓库通过 `@modelcontextprotocol/sdk` 在 stdio 上注册并提供一组工具，便于客户端进程执行常见的嵌入式开发任务：串口 I/O、ST‑Link 刷写与调试、项目脚手架与构建调用。

支持的功能

- 串口：`listPorts`、`openPort`、`write`、`read`、`closePort`

- ST‑Link：`st.listDevices`、`st.flashFirmware`、`st.readRegister`、`st.resetDevice`、`st.startDebug`、`st.stopDebug`、GDB 帮助（`st.setBreakpoint`、`st.step`、`st.readVar`）

- 构建：`compile`（支持 `make` 和 STM32CubeIDE 的 headless 构建）

- 项目管理：`createProject`、`getFileList`、`readFile`、`writeFile`、`gitCommit`、`gitDiff`

快速开始

前提条件：

- Node.js >= 18.18

- 平台相关工具（用于 ST 功能）：`st-info`、`st-flash`、`st-util`（开源 stm32 工具）或 `ST-LINK_CLI.exe`（官方 ST 工具）。如需使用 CubeIDE 构建，还可能需要 `stm32cubeide`。

安装与运行：

```bash
npm install
npm start
```

环境变量（可选）

- `ST_LINK_CLI_PATH` — 指向 `ST-LINK_CLI.exe` 的绝对路径

- `ST_INFO_PATH` — 指向 `st-info` 的路径

- `ST_FLASH_PATH` — 指向 `st-flash` 的路径

- `ST_UTIL_PATH` — 指向 `st-util` 的路径

- `CUBEIDE_CLI` — 指向 `stm32cubeide` CLI 的路径

用法：工具与示例

服务在 `index.js` 中注册了一系列工具。每个工具接收与其 inputSchema 匹配的对象作为参数，并返回结构化结果。

JSON‑RPC over stdio 示例（Node.js）

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

串口示例

1. 调用 `listPorts` 列举可用 COM 端口。

2. 调用 `openPort`，例如 `{ name: 'COM3', baudRate: 115200 }`。

3. 调用 `write`，例如 `{ data: 'hello', encoding: 'utf8' }`。

4. 可选地调用 `read`，例如 `{ maxBytes, timeoutMs }`。

5. 使用完成后调用 `closePort`。

ST‑Link 示例

- `st.listDevices()` — 探测可用 ST‑Link 设备。

- `st.flashFirmware({ path: './build/app.bin', addr: '0x08000000' })` — 刷写固件（需要 `st-flash` 或 `ST-LINK_CLI`）。

- `st.startDebug({ port: 4242 })` — 启动 `st-util` GDB 服务（在后台保持进程句柄）。

构建示例

- Make：调用 `compile({ target: 'all', cwd: '/path/to/project', tool: 'make' })`（服务将在给定 `cwd` 下运行 `make`）。

- STM32CubeIDE：调用 `compile({ tool: 'cubeide', cwd: <workspace>, project: <projectPath> })` — 需要 `CUBEIDE_CLI` 可用。

项目脚手架

使用 `createProject({ template: 'bare', path: './myproj' })` 可以在 `./myproj` 下生成最小的基于 Makefile 的 STM32 骨架项目。

故障排查

- `serialport` 原生模块安装失败：请确保平台本机构建工具或预构建二进制可用；Windows 上建议使用预构建或安装相应的构建工具。

- 打开 COM 端口权限被拒绝：请确保没有其他进程占用端口，并使用合适的权限运行程序。

- 找不到 ST 工具：安装 `st-flash`、`st-util`（来自开源 stm32 工具链）或配置 `ST_LINK_CLI_PATH`。

项目进度（MVP 状态）

- 串口（`serial.js`）：已实现 — list/open/write/read/close，单活动端口模型。

- ST‑Link（`stlink.js`）：已实现核心流程 — 设备列举、刷写、读内存（通过 tmp 文件 + `st-flash`）、调试服务器；限制：`writeRegister` 在 CLI 层不支持（需 GDB 脚本），某些 GDB 操作为 MVP，依赖 `st-util` 构建版本差异。

- 编译器（`compiler.js`）：已实现 — 支持 `make` 和 STM32CubeIDE CLI 的检测与 headless 命令模板。

- 项目（`project.js`）：已实现 — `createProject`（bare 模板）、文件读写、git 助手（`gitCommit`、`gitDiff`）。

贡献

欢迎贡献。请通过 issue 或 PR 提交。遵循仓库风格（ES modules，清晰的错误消息）。注意：仓库作为库使用时不会自动执行 git 操作；`git*` 助手通过 shell 调用 `git`。

许可证

本项目采用 MIT 许可证。参见 `LICENSE`。
