// index.js
// MCP server exposing Serial (COM) and ST-Link tools via JSON-RPC over stdio
// - Serial tools delegate to ./serial.js (serialport-based)
// - ST-Link tools delegate to ./stlink.js (child_process to st-* / ST-LINK_CLI)

// 使用 MCP 高级封装以兼容不同版本的 SDK
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
// 引入 StdioServerTransport：修复模块导入路径（使用已安装包中的实际导出路径）
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as serial from './serial.js';
import * as stlink from './stlink.js';
import * as compiler from './compiler.js';
import * as project from './project.js';

// No local state needed; state lives in modules

// ---------------------------
// MCP Server & Tools
// ---------------------------

// 兼容适配器：原始代码使用 server.addTool(...) 接口，但 SDK 提供的是 McpServer.registerTool
// 这里构造一个轻量的兼容封装，使原来的 server.addTool 调用继续有效。
const _mcp = new McpServer({ name: 'mcp-serialport-service', version: '0.1.0' });

class CompatServer {
  constructor(mcp) {
    this._mcp = mcp;
    // 暴露底层 server 用于 connect/transport 等操作
    this.transportServer = mcp.server;
  }

  // 保持原有 addTool(signature) 的调用方式：addTool(def, callback)
  addTool(def, callback) {
    const name = def.name;
    const config = {
      title: def.title || name,
      description: def.description,
      inputSchema: def.inputSchema,
      annotations: def.annotations,
    };
    // registerTool 返回已注册的工具对象
    return this._mcp.registerTool(name, config, async (args, extra) => {
      // 兼容原来回调的行为：如果工具定义没有 params schema，原回调可能只接收 extra
      try {
        if (def.inputSchema) {
          return await callback(args, extra);
        }
        else {
          return await callback(extra);
        }
      } catch (e) {
        // 将错误转换为 MCP 错误结果格式（由上层处理）
        throw e;
      }
    });
  }

  // 连接 transport（转发到 McpServer.connect）
  async connect(transport) {
    return await this._mcp.connect(transport);
  }

  // 允许直接访问底层 server（必要时）
  get server() { return this.transportServer; }
}

const server = new CompatServer(_mcp);

// Serial: listPorts(): Return available COM ports (Windows) or serial device paths
server.addTool(
  {
    name: 'listPorts',
    description: 'List available serial ports (COM ports on Windows).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  async () => {
    const result = await serial.listPorts();
    return {
      content: [
        { type: 'text', text: JSON.stringify(result, null, 2) },
      ],
    };
  }
);

// Serial: openPort({ name, baudRate, ... })
server.addTool(
  {
    name: 'openPort',
    description: 'Open a serial port by name (e.g., COM3) with the given baud rate.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Port name, e.g., COM3' },
        baudRate: { type: 'integer', minimum: 1, default: 9600 },
        dataBits: { type: 'integer', enum: [5, 6, 7, 8], default: 8 },
        stopBits: { type: 'integer', enum: [1, 2], default: 1 },
        parity: { type: 'string', enum: ['none', 'even', 'odd', 'mark', 'space'], default: 'none' },
        rtscts: { type: 'boolean', default: false },
        xon: { type: 'boolean', default: false },
        xoff: { type: 'boolean', default: false },
        xany: { type: 'boolean', default: false },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  async (args) => {
    const res = await serial.openPort(args);
    return { content: [{ type: 'text', text: res.message }] };
  }
);

// Serial: write({ data, encoding })
server.addTool(
  {
    name: 'write',
    description: 'Write data to the open serial port.',
    inputSchema: {
      type: 'object',
      properties: {
        data: { type: 'string', description: 'Data to send' },
        encoding: { type: 'string', enum: ['utf8', 'hex', 'base64'], default: 'utf8' },
        appendNewline: { type: 'boolean', default: false },
      },
      required: ['data'],
      additionalProperties: false,
    },
  },
  async (args) => {
    const res = await serial.write(args);
    return { content: [{ type: 'text', text: `Wrote ${res.bytes} bytes` }] };
  }
);

// Serial: read({ maxBytes?, encoding?, timeoutMs? })
server.addTool(
  {
    name: 'read',
    description: 'Read data from the open serial port receive buffer. Optionally wait for data.',
    inputSchema: {
      type: 'object',
      properties: {
        maxBytes: { type: 'integer', minimum: 1, maximum: 1048576, default: 65536 },
        encoding: { type: 'string', enum: ['utf8', 'hex', 'base64'], default: 'utf8' },
        timeoutMs: { type: 'integer', minimum: 0, maximum: 60000, default: 0 },
      },
      required: [],
      additionalProperties: false,
    },
  },
  async (args) => {
    const res = await serial.read(args || {});
    return { content: [{ type: 'text', text: res.data }] };
  }
);

// Serial: closePort()
server.addTool(
  {
    name: 'closePort',
    description: 'Close the currently open serial port.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  async () => {
    const res = await serial.closePort();
    return { content: [{ type: 'text', text: res.message }] };
  }
);

// ---------------------------
// ST-Link Tools
// ---------------------------

server.addTool(
  {
    name: 'st.listDevices',
    description: 'List available ST-Link devices using st-info or ST-LINK_CLI.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  async () => {
    const res = await stlink.listDevices();
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

server.addTool(
  {
    name: 'st.flashFirmware',
    description: 'Flash firmware to MCU using st-flash or ST-LINK_CLI.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative path to firmware binary/hex' },
        addr: { type: 'string', description: 'Load address (hex like 0x08000000) or decimal', nullable: true },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  async (args) => {
    const res = await stlink.flashFirmware(args);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

server.addTool(
  {
    name: 'st.readRegister',
    description: 'Read memory/register at address using st-flash dump.',
    inputSchema: {
      type: 'object',
      properties: {
        addr: { type: 'string', description: 'Address (0x... or decimal)' },
        length: { type: 'integer', minimum: 1, maximum: 1024, default: 4 },
      },
      required: ['addr'],
      additionalProperties: false,
    },
  },
  async (args) => {
    const res = await stlink.readRegister(args);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

server.addTool(
  {
    name: 'st.writeRegister',
    description: 'Write memory/register value (requires GDB flow; returns error if unsupported).',
    inputSchema: {
      type: 'object',
      properties: {
        addr: { type: 'string', description: 'Address (0x... or decimal)' },
        value: { type: 'string', description: 'Value (0x... or decimal)' },
      },
      required: ['addr', 'value'],
      additionalProperties: false,
    },
  },
  async (args) => {
    const res = await stlink.writeRegister(args);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

server.addTool(
  {
    name: 'st.resetDevice',
    description: 'Reset target MCU using st-flash or ST-LINK_CLI.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  async () => {
    const res = await stlink.resetDevice();
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

server.addTool(
  {
    name: 'st.startDebug',
    description: 'Start st-util GDB server (default port 4242).',
    inputSchema: {
      type: 'object',
      properties: { port: { type: 'integer', minimum: 1, maximum: 65535, default: 4242 } },
      required: [],
      additionalProperties: false,
    },
  },
  async (args) => {
    const res = await stlink.startDebug(args || {});
    return { content: [{ type: 'text', text: res.message }] };
  }
);

server.addTool(
  {
    name: 'st.stopDebug',
    description: 'Stop st-util GDB server if running.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  async () => {
    const res = await stlink.stopDebug();
    return { content: [{ type: 'text', text: res.message }] };
  }
);

// GDB-like helpers
server.addTool(
  {
    name: 'st.setBreakpoint',
    description: 'Set a breakpoint at given address via st-util monitor.',
    inputSchema: { type: 'object', properties: { addr: { type: 'string' } }, required: ['addr'], additionalProperties: false },
  },
  async (args) => {
    const res = await stlink.setBreakpoint(args);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

server.addTool(
  {
    name: 'st.step',
    description: 'Single step via st-util monitor.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  async () => {
    const res = await stlink.step();
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

server.addTool(
  {
    name: 'st.readVar',
    description: 'Attempt to read a variable using GDB print (requires running debug server).',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false },
  },
  async (args) => {
    const res = await stlink.readVar(args);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ---------------------------
// Compiler Tools
// ---------------------------

server.addTool(
  {
    name: 'compile',
    description: 'Compile an STM32 project using make or STM32CubeIDE headless.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', default: 'all' },
        cwd: { type: 'string', description: 'Project directory' },
        tool: { type: 'string', enum: ['make', 'cubeide'], default: 'make' },
        project: { type: 'string', description: 'For cubeide: project path to import/build' }
      },
      required: [],
      additionalProperties: false,
    },
  },
  async (args) => {
    const res = await compiler.compile(args || {});
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ---------------------------
// Project Tools
// ---------------------------

server.addTool(
  {
    name: 'createProject',
    description: 'Create a new STM32 project from a template at a target path.',
    inputSchema: {
      type: 'object',
      properties: { template: { type: 'string', default: 'bare' }, path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  async (args) => {
    const res = await project.createProject(args);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

server.addTool(
  {
    name: 'getFileList',
    description: 'List files under a project directory.',
    inputSchema: {
      type: 'object',
      properties: { cwd: { type: 'string' } },
      required: [],
      additionalProperties: false,
    },
  },
  async (args) => {
    const res = await project.getFileList(args || {});
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

server.addTool(
  {
    name: 'readFile',
    description: 'Read a file content.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, cwd: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  async (args) => {
    const res = await project.readFile(args);
    return { content: [{ type: 'text', text: res.content }] };
  }
);

server.addTool(
  {
    name: 'writeFile',
    description: 'Write content to a file (creates directories as needed).',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' }, cwd: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  async (args) => {
    const res = await project.writeFile(args);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

server.addTool(
  {
    name: 'gitCommit',
    description: 'Commit all changes in the repo with the provided message.',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string' }, cwd: { type: 'string' } },
      required: ['message'],
      additionalProperties: false,
    },
  },
  async (args) => {
    const res = await project.gitCommit(args);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

server.addTool(
  {
    name: 'gitDiff',
    description: 'Return current git diff for the project.',
    inputSchema: { type: 'object', properties: { cwd: { type: 'string' } }, additionalProperties: false },
  },
  async (args) => {
    const res = await project.gitDiff(args || {});
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
);

// ---------------------------
// Start MCP stdio transport
// ---------------------------

const transport = new StdioServerTransport();
await server.connect(transport);

// Graceful shutdown
process.on('SIGINT', async () => {
  try { await serial.closePort(); } catch {}
  process.exit(0);
});

