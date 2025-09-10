// serial.js
// Encapsulates serial (COM) port operations using the serialport library.
// Provides: listPorts, openPort, write, read, closePort
// This module maintains a single active port for simplicity.

import { SerialPort } from 'serialport';

/** @type {import('serialport').SerialPort | null} */
let activePort = null;
let activePortName = '';
let rxBuffer = Buffer.alloc(0);

function normalizeComName(name) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('Invalid port name');
  }
  return name; // serialport supports COM10+ without special prefix
}

function ensureOpen() {
  if (!activePort || !activePort.isOpen) {
    throw new Error(`Serial port is not open${activePortName ? `: ${activePortName}` : ''}`);
  }
}

export async function listPorts() {
  const ports = await SerialPort.list();
  return ports.map((p) => ({
    path: p.path,
    manufacturer: p.manufacturer || null,
    serialNumber: p.serialNumber || null,
    friendlyName: p.friendlyName || null,
    vendorId: p.vendorId || null,
    productId: p.productId || null,
  }));
}

export async function openPort(options) {
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
  } = options || {};

  if (activePort && activePort.isOpen) {
    throw new Error(`A port is already open: ${activePortName}. Close it first.`);
  }

  const path = normalizeComName(name);
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
    port.open((err) => (err ? reject(err) : resolve()));
  }).catch((err) => {
    if (err && typeof err.message === 'string') {
      if (/access\s*denied|permission/i.test(err.message)) {
        throw new Error(`Access denied opening ${path}. In use or admin required? (${err.message})`);
      }
      if (/file\s*not\s*found|does\s*not\s*exist|no\s*such/i.test(err.message)) {
        throw new Error(`Port not found: ${path}`);
      }
    }
    throw err;
  });

  rxBuffer = Buffer.alloc(0);
  port.on('data', (chunk) => {
    if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk);
    rxBuffer = rxBuffer.length === 0 ? chunk : Buffer.concat([rxBuffer, chunk]);
  });
  port.on('close', () => {
    activePort = null;
    activePortName = '';
  });
  port.on('error', () => {
    // Non-fatal for module state; errors surface via operations
  });

  activePort = port;
  activePortName = path;
  return { message: `Opened ${path} @ ${baudRate} baud` };
}

export async function write({ data, encoding = 'utf8', appendNewline = false }) {
  ensureOpen();
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
      activePort.drain((e) => (e ? reject(e) : resolve()));
    });
  });
  return { bytes: bufferToSend.length };
}

export async function read({ maxBytes = 65536, encoding = 'utf8', timeoutMs = 0 } = {}) {
  ensureOpen();
  const readFromBuffer = () => {
    if (rxBuffer.length === 0) return null;
    const take = Math.min(rxBuffer.length, maxBytes);
    const chunk = rxBuffer.subarray(0, take);
    rxBuffer = rxBuffer.subarray(take);
    return chunk;
  };
  let chunk = readFromBuffer();
  if (!chunk && timeoutMs > 0) {
    chunk = await new Promise((resolve) => {
      let t;
      const onData = () => {
        const c = readFromBuffer();
        if (c) {
          clearTimeout(t);
          activePort.off('data', onData);
          resolve(c);
        }
      };
      activePort.on('data', onData);
      t = setTimeout(() => {
        activePort.off('data', onData);
        resolve(null);
      }, timeoutMs);
    });
  }
  if (!chunk) return { data: '', bytes: 0 };
  return { data: chunk.toString(encoding), bytes: chunk.length };
}

export async function closePort() {
  if (activePort && activePort.isOpen) {
    await new Promise((resolve, reject) => {
      activePort.close((err) => (err ? reject(err) : resolve()));
    });
  }
  activePort = null;
  activePortName = '';
  rxBuffer = Buffer.alloc(0);
  return { message: 'Port closed' };
}

