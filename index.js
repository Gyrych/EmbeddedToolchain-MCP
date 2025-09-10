// index.js
// MCP Serial Port (COM) server for Windows using Node.js and serialport
// - Exposes MCP tools via JSON-RPC over stdio using @modelcontextprotocol/sdk
// - Tools: listPorts, openPort, write, read, closePort
// - Robust error handling and buffered reads

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/transport/stdio.js';
import { SerialPort } from 'serialport';

// ---------------------------
// State and helpers
// ---------------------------

/**
 * The active SerialPort instance or null when closed.
 * We support opening a single port at a time for simplicity. You can extend
 * this to support multiple ports by tracking a map of name -> port/buffer.
 */
let activePort = /** @type {import('serialport').SerialPort | null} */ (null);

/** Accumulated receive buffer for the active port. */
let rxBuffer = Buffer.alloc(0);

/** Last opened port name for error messages/logging. */
let activePortName = '';

/**
 * Normalize Windows COM port names.
 * serialport handles COM10+ internally, so we keep the provided name.
 * This function exists to document intent and allow future adjustments
 * (e.g., converting to \\ . \\ COM10 style if ever needed).
 */
function normalizeComName(name) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('Invalid port name');
  }
  return name; // serialport supports 'COM1'..'COM20' including COM10+
}

function ensurePortOpen() {
  if (!activePort || !activePort.isOpen) {
    const label = activePortName || 'UNKNOWN';
    throw new Error(`Serial port is not open${activePortName ? `: ${label}` : ''}`);
  }
}

/**
 * Safely close current active port.
 */
async function closeActivePortIfAny() {
  if (activePort && activePort.isOpen) {
    await new Promise((resolve, reject) => {
      activePort.close((err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
  activePort = null;
  activePortName = '';
  rxBuffer = Buffer.alloc(0);
}

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

// listPorts(): Return available COM ports (Windows) or serial device paths (other OS)
server.addTool(
  {
    name: 'listPorts',
    description: 'List available serial ports (COM ports on Windows).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  async () => {
    const ports = await SerialPort.list();
    // Return only path names, but include friendly info in JSON for clarity
    const result = ports.map((p) => ({
      path: p.path,
      manufacturer: p.manufacturer || null,
      serialNumber: p.serialNumber || null,
      friendlyName: p.friendlyName || null,
      vendorId: p.vendorId || null,
      productId: p.productId || null,
    }));
    return {
      content: [
        { type: 'text', text: JSON.stringify(result, null, 2) },
      ],
    };
  }
);

// openPort({ name, baudRate })
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
    const {
      name,
      baudRate = 9600,
      dataBits = 8,
      stopBits = 1,
      parity = 'none',
      rtscts = false,
      xon = false,
      xoff = false,
      xany = false,
    } = /** @type {any} */ (args || {});

    if (activePort && activePort.isOpen) {
      throw new Error(`A port is already open: ${activePortName}. Close it first.`);
    }

    const path = normalizeComName(name);

    // Initialize (autoOpen: false) to surface open errors via callback
    const port = new SerialPort({
      path,
      baudRate,
      dataBits,
      stopBits,
      parity,
      rtscts,
      xon,
      xoff,
      xany,
      autoOpen: false,
    });

    await new Promise((resolve, reject) => {
      port.open((err) => {
        if (err) return reject(err);
        return resolve();
      });
    }).catch((err) => {
      // Translate common Windows errors for clarity
      if (err && typeof err.message === 'string') {
        if (/access\s*denied|permission/i.test(err.message)) {
          throw new Error(`Access denied opening ${path}. Is it in use or needs admin rights? (${err.message})`);
        }
        if (/file\s*not\s*found|does\s*not\s*exist|no\s*such/i.test(err.message)) {
          throw new Error(`Port not found: ${path}`);
        }
      }
      throw err;
    });

    // Setup listeners for buffering
    rxBuffer = Buffer.alloc(0);
    port.on('data', (chunk) => {
      if (!Buffer.isBuffer(chunk)) {
        chunk = Buffer.from(chunk);
      }
      rxBuffer = rxBuffer.length === 0 ? chunk : Buffer.concat([rxBuffer, chunk]);
    });
    // Handle unexpected close/errors
    port.on('close', () => {
      activePort = null;
      activePortName = '';
    });
    port.on('error', (e) => {
      // Keep the process alive; the client will surface tool errors separately
      // We could add logging here in the future.
    });

    activePort = port;
    activePortName = path;
    return {
      content: [
        { type: 'text', text: `Opened ${path} @ ${baudRate} baud` },
      ],
    };
  }
);

// write({ data, encoding })
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
    ensurePortOpen();
    const { data, encoding = 'utf8', appendNewline = false } = /** @type {any} */ (args || {});
    let bufferToSend;
    if (encoding === 'utf8') {
      bufferToSend = Buffer.from(appendNewline ? `${data}\n` : data, 'utf8');
    } else {
      const raw = appendNewline ? `${data}${encoding === 'hex' ? '0a' : '\n'}` : data;
      bufferToSend = Buffer.from(raw, encoding);
    }

    await new Promise((resolve, reject) => {
      activePort.write(bufferToSend, (err) => {
        if (err) return reject(err);
        activePort.drain((drainErr) => {
          if (drainErr) return reject(drainErr);
          resolve();
        });
      });
    });

    return { content: [{ type: 'text', text: `Wrote ${bufferToSend.length} bytes` }] };
  }
);

// read({ maxBytes?, encoding?, timeoutMs? })
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
    ensurePortOpen();
    const { maxBytes = 65536, encoding = 'utf8', timeoutMs = 0 } = /** @type {any} */ (args || {});

    const readFromBuffer = () => {
      if (rxBuffer.length === 0) return null;
      const take = Math.min(rxBuffer.length, maxBytes);
      const chunk = rxBuffer.subarray(0, take);
      rxBuffer = rxBuffer.subarray(take);
      return chunk;
    };

    let data = readFromBuffer();
    if (!data && timeoutMs > 0) {
      data = await new Promise((resolve) => {
        let timeoutId;
        const onData = () => {
          const c = readFromBuffer();
          if (c) {
            clearTimeout(timeoutId);
            activePort.off('data', onData);
            resolve(c);
          }
        };
        activePort.on('data', onData);
        timeoutId = setTimeout(() => {
          activePort.off('data', onData);
          resolve(null);
        }, timeoutMs);
      });
    }

    if (!data) {
      return { content: [{ type: 'text', text: '' }] };
    }

    const text = data.toString(encoding);
    return { content: [{ type: 'text', text }] };
  }
);

// closePort()
server.addTool(
  {
    name: 'closePort',
    description: 'Close the currently open serial port.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  async () => {
    await closeActivePortIfAny();
    return { content: [{ type: 'text', text: 'Port closed' }] };
  }
);

// ---------------------------
// Start MCP stdio transport
// ---------------------------

const transport = new StdioServerTransport();
await server.connect(transport);

// Graceful shutdown
process.on('SIGINT', async () => {
  try { await closeActivePortIfAny(); } catch {}
  process.exit(0);
});

