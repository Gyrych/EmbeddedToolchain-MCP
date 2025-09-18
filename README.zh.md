<!--
  自动更新的 README - 中文
  目的：为中文使用者提供一致的安装、使用与示例说明。
-->

# MCP Serialport 服务

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) [![node](https://img.shields.io/badge/node-%3E%3D18.18-brightgreen)](https://nodejs.org/) [![status](https://img.shields.io/badge/status--placeholder-lightgrey)](#)

轻量级 MCP（Model Context Protocol）stdio 服务，通过 stdio 暴露串口（COM）和 ST‑Link 帮助工具，便于 STM32 开发流程自动化。

该仓库通过 `@modelcontextprotocol/sdk` 在 stdio 上注册一组 JSON‑RPC 工具，客户端进程可以调用这些工具来完成常见的嵌入式开发任务：串口 I/O、ST‑Link 刷写与调试、项目脚手架以及构建调用。

主要功能

- **串口**：`listPorts`、`openPort`、`write`、`read`、`closePort`
- **ST‑Link**：`st.listDevices`、`st.flashFirmware`、`st.readRegister`、`st.resetDevice`、`st.startDebug`、`st.stopDebug`
- **GDB 帮助（实验性）**：`st.setBreakpoint`、`st.step`、`st.readVar`（行为依赖于 st-util/GDB 的兼容性）
- **构建**：`compile`（支持 `make` 与 STM32CubeIDE headless 构建）
- **项目管理**：`createProject`、`getFileList`、`readFile`、`writeFile`、`gitCommit`、`gitDiff`

前提条件

- Node.js >= 18.18
- 可选平台工具（用于 ST 功能）：`st-info`、`st-flash`、`st-util`（开源 stm32 工具）或 `ST-LINK_CLI.exe`（官方 ST 工具）。如需 CubeIDE 无头构建，需提供 `stm32cubeide` CLI。

快速开始

安装依赖并启动服务：

```bash
npm install
npm start
```

可用 npm 脚本

- `npm start` — 启动服务（`node ./index.js`）
- `npm run check` — 运行依赖快速检测（尝试导入 `@modelcontextprotocol/sdk` 与 `serialport`）

环境变量（可选）

- `ST_LINK_CLI_PATH` — 指向 `ST-LINK_CLI.exe` 的绝对路径
- `ST_INFO_PATH` — 指向 `st-info` 的路径
- `ST_FLASH_PATH` — 指向 `st-flash` 的路径
- `ST_UTIL_PATH` — 指向 `st-util` 的路径
- `CUBEIDE_CLI` — 指向 `stm32cubeide` CLI 的路径

使用与示例

服务在 `index.js` 中注册具体工具。每个工具接收与其输入 schema 匹配的对象作为参数并返回结构化结果。生产环境建议使用 `@modelcontextprotocol/sdk` 提供的 MCP 客户端实现；下面示例用于快速测试。

Node 子进程示例（快速测试）

> **注意：** 此最小示例仅用于手动快速测试 — MCP SDK 期望使用带帧的消息和正式的 MCP 客户端。生产环境请使用 `@modelcontextprotocol/sdk` 提供的 MCP 客户端。

```javascript
// 简单示例：启动服务并通过 stdin 发送 JSON-RPC 风格的请求
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

串口使用示例（概念性说明）

1. 调用 `listPorts` 列举 COM 端口。
2. 调用 `openPort`，例如 `{ name: 'COM3', baudRate: 115200 }`。
3. 调用 `write`，例如 `{ data: 'hello', encoding: 'utf8' }`。
4. 调用 `read`（可选），例如 `{ maxBytes, timeoutMs }`。
5. 使用完成后调用 `closePort`。

ST‑Link 示例

- `st.listDevices()` — 探测 ST‑Link 设备。
- `st.flashFirmware({ path: './build/app.bin', addr: '0x08000000' })` — 刷写固件（需要 `st-flash`、`ST-LINK_CLI` 或 `STM32_Programmer_CLI`）。
- `st.startDebug({ port: 4242 })` — 启动 `st-util` GDB 服务（启动后台调试服务器并返回状态消息；进程句柄保存在模块内部，不会作为返回值暴露）。

构建示例

- Make：`compile({ target: 'all', cwd: '/path/to/project', tool: 'make' })` — 在 `cwd` 运行 `make`。
- STM32CubeIDE：`compile({ tool: 'cubeide', cwd: <workspace>, project: <projectPath> })` — 需要 `CUBEIDE_CLI`。

项目脚手架

使用 `createProject({ template: 'bare', path: './myproj' })` 生成最小的基于 Makefile 的 STM32 项目骨架。

OpenOCD 与 J-Link

本项目还通过 `openocd.js` 与 `jlink.js` 暴露了 OpenOCD 与 SEGGER J-Link 的操作：

- **OpenOCD**（默认 GDB 端口 3333）：`ocd.startDebug`、`ocd.stopDebug`、`ocd.flashFirmware`、`ocd.resetDevice`、`ocd.readRegister`、`ocd.version`。
- **J-Link**（默认 GDB 端口 2331）：`jlink.startDebug`、`jlink.stopDebug`、`jlink.flashFirmware`、`jlink.resetDevice`、`jlink.readRegister`、`jlink.version`。

示例：启动 OpenOCD 调试服务器

```js
// 启动 openocd，指定 interface / target（返回状态消息）
await mcp.call('ocd.startDebug', { interface: 'stlink', target: 'stm32f4x', port: 3333 });
```

示例：启动 J-Link GDB 服务

```js
// 启动 JLinkGDBServerCL（返回状态消息）
await mcp.call('jlink.startDebug', { device: 'STM32F407VG', if: 'SWD', port: 2331 });
```

示例：使用 OpenOCD 刷写

```js
await mcp.call('ocd.flashFirmware', { path: './build/app.bin', interface: 'stlink', target: 'stm32f4x' });
```

示例：使用 J-Link Commander 刷写

```js
await mcp.call('jlink.flashFirmware', { path: './build/app.bin', device: 'STM32F407VG', if: 'SWD', addr: '0x08000000' });
```

OpenOCD / J-Link 注意事项与故障排查

- 确保 CLI 工具已安装并通过上文环境变量或 PATH 可访问。
- 默认 GDB 端口：OpenOCD 使用 3333，J-Link 使用 2331（可覆盖）。
- `ocd.readRegister` / `jlink.readRegister` 实现可能会写临时文件或以文本形式输出内存，返回值分别为字节数组或文本输出。
- 如果 `startDebug` 启动失败，检查 interface/target 配置文件是否存在，以及是否有其它进程占用了 GDB 端口。
- 在 Windows 上，如果可执行文件未在 PATH，中需要通过 `OPENOCD_PATH`、`JLINK_EXE_PATH` 或 `JLINK_GDB_SERVER_PATH` 指定绝对路径。

故障排查

- `serialport` 原生模块安装问题：请确保系统有构建工具或使用预构建二进制；Windows 上推荐使用预构建版本。
- 打开 COM 端口权限被拒绝：检查是否有其他进程占用端口并以合适权限运行。
- 找不到 ST 工具：安装 `st-flash`、`st-util`（开源）、`STM32_Programmer_CLI`，或配置 `ST_LINK_CLI_PATH`。

- `st.writeRegister` 限制：`st.writeRegister` 虽已注册，但无法通过简单的 CLI 流程完成；除非在 GDB 调试会话内部执行，否则会返回错误。要写寄存器，请使用 `st.startDebug` 并通过 GDB 执行。

项目状态（MVP）

- `serial.js`：list/open/write/read/close 已实现（单活动端口模型）。
- `stlink.js`：实现设备列举、刷写、读内存和调试服务器；部分 GDB 功能为 MVP，依赖 `st-util` 构建版本。
- `compiler.js`：支持 `make` 并检测 STM32CubeIDE CLI 模板。
- `project.js`：实现 `createProject`、文件读写及 git 助手的 shell 调用。

贡献

欢迎贡献。请通过 issue 或 PR 提交。遵循 ES module 风格并编写清晰错误消息。注意：git 助手通过 shell 调用 `git`，仓库本身不会自动执行 git 操作。

许可证

本项目采用 MIT 许可证。参见 `LICENSE`。
