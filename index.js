// index.js
// MCP server exposing Serial (COM) and ST-Link tools via JSON-RPC over stdio
// - Serial tools delegate to ./serial.js (serialport-based)
// - ST-Link tools delegate to ./stlink.js (child_process to st-* / ST-LINK_CLI)

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/transport/stdio.js';
import * as serial from './serial.js';
import * as stlink from './stlink.js';

// No local state needed; state lives in modules

// ---------------------------
// MCP Server & Tools
// ---------------------------

const server = new Server(
  {
    name: 'mcp-serialport-service',
    version: '0.1.0',
  },
  {
    // Advertise generic capabilities only; tools are dynamically listed
  }
);

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

