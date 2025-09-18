// stlink.js
// Encapsulates ST-Link operations by invoking ST CLI tools via child_process.
// Tools supported (typical on Windows with STM32 toolchain installed):
// - ST-LINK_CLI.exe (ST official) or open-source stm32 tools like st-info, st-flash, st-util
// We implement using commonly available "st-info"/"st-flash"/"st-util" when present,
// and try to fall back to ST-LINK_CLI.exe if configured via environment.
//
// Exposed functions:
// - listDevices()
// - flashFirmware({ path })
// - readRegister({ addr })
// - writeRegister({ addr, value })
// - resetDevice()
// - startDebug()
// - stopDebug()
//
// Note: startDebug() launches st-util in background and keeps its process handle.
//       stopDebug() terminates it. read/writeRegister use st-util + GDB monitor when available
//       is non-trivial; for MVP we use st-flash --read or ST-LINK_CLI if provided.

import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';

const execFileAsync = promisify(execFile);

// Track st-util debug server process
let stUtilProc = null;
let gdbPort = 4242;

// Discover tool paths or names (assume PATH has them). Optionally set via env.
const ST_LINK_CLI = process.env.ST_LINK_CLI_PATH || 'ST-LINK_CLI.exe';
const STM32_PROGRAMMER_CLI = process.env.STM32_PROGRAMMER_CLI_PATH || 'STM32_Programmer_CLI.exe';
const ST_INFO = process.env.ST_INFO_PATH || 'st-info';
const ST_FLASH = process.env.ST_FLASH_PATH || 'st-flash';
const ST_UTIL = process.env.ST_UTIL_PATH || 'st-util';

async function isExecutable(cmd) {
  // If cmd is an absolute or relative path, check it; otherwise rely on shell PATH by trying exec.
  const looksLikePath = /[\\/]/.test(cmd) || /\.exe$/i.test(cmd);
  if (looksLikePath) {
    try {
      await access(cmd, fsConstants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  // Try running with --version to detect availability
  try {
    await execFileAsync(cmd, ['--version'], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function parseIntHexOrDec(value, name) {
  if (typeof value === 'number') return value >>> 0;
  if (typeof value !== 'string') throw new Error(`${name} must be hex string (0x...) or number`);
  const v = value.trim().toLowerCase().startsWith('0x') ? parseInt(value, 16) : parseInt(value, 10);
  if (!Number.isFinite(v)) throw new Error(`${name} is not a valid number`);
  return v >>> 0;
}

export async function listDevices() {
  // Try st-info --probe
  if (await isExecutable(ST_INFO)) {
    try {
      const { stdout } = await execFileAsync(ST_INFO, ['--probe'], { windowsHide: true });
      const lines = stdout.split(/\r?\n/).filter(Boolean);
      return { tool: 'st-info', devices: lines };
    } catch (e) {
      // fall through to other tools
    }
  }
  // Try ST-LINK_CLI.exe -List
  if (await isExecutable(ST_LINK_CLI)) {
    try {
      const { stdout } = await execFileAsync(ST_LINK_CLI, ['-List'], { windowsHide: true });
      return { tool: 'ST-LINK_CLI', devices: stdout.split(/\r?\n/).filter(Boolean) };
    } catch {}
  }
  // Try STM32_Programmer_CLI.exe -l
  if (await isExecutable(STM32_PROGRAMMER_CLI)) {
    try {
      const { stdout } = await execFileAsync(STM32_PROGRAMMER_CLI, ['-l'], { windowsHide: true });
      return { tool: 'STM32_Programmer_CLI', devices: stdout.split(/\r?\n/).filter(Boolean) };
    } catch {}
  }
  // If none available
  throw new Error('No ST-Link tools found. Install stlink (st-info/st-flash/st-util) or STM32CubeProgrammer (STM32_Programmer_CLI.exe), or set env paths.');
}

export async function flashFirmware({ path: fwPath, addr }) {
  if (typeof fwPath !== 'string' || fwPath.length === 0) {
    throw new Error('Invalid firmware path');
  }
  const abs = path.isAbsolute(fwPath) ? fwPath : path.resolve(process.cwd(), fwPath);

  // Try st-flash write <file> <address>
  if (await isExecutable(ST_FLASH)) {
    const address = addr != null ? parseIntHexOrDec(addr, 'addr') : 0x08000000;
    const args = ['write', abs, '0x' + address.toString(16)];
    try {
      const { stdout, stderr } = await execFileAsync(ST_FLASH, args, { windowsHide: true });
      return { tool: 'st-flash', stdout, stderr };
    } catch (e) {
      const msg = e?.stderr || e?.stdout || e?.message || String(e);
      throw new Error(`st-flash failed: ${msg}`);
    }
  }
  // Fallback: ST-LINK_CLI.exe -P <file> <addr> -Rst
  if (await isExecutable(ST_LINK_CLI)) {
    const address = addr != null ? parseIntHexOrDec(addr, 'addr') : 0x08000000;
    const args = ['-P', abs, address.toString(), '-V', '-Rst'];
    try {
      const { stdout, stderr } = await execFileAsync(ST_LINK_CLI, args, { windowsHide: true });
      return { tool: 'ST-LINK_CLI', stdout, stderr };
    } catch (e) {
      const msg = e?.stderr || e?.stdout || e?.message || String(e);
      throw new Error(`ST-LINK_CLI failed: ${msg}`);
    }
  }
  // Fallback: STM32_Programmer_CLI.exe -c port=SWD -w <file> [addr] -v -rst
  if (await isExecutable(STM32_PROGRAMMER_CLI)) {
    const address = addr != null ? parseIntHexOrDec(addr, 'addr') : 0x08000000;
    const args = ['-c', 'port=SWD', '-w', abs, '0x' + address.toString(16), '-v', '-rst'];
    try {
      const { stdout, stderr } = await execFileAsync(STM32_PROGRAMMER_CLI, args, { windowsHide: true });
      return { tool: 'STM32_Programmer_CLI', stdout, stderr };
    } catch (e) {
      const msg = e?.stderr || e?.stdout || e?.message || String(e);
      throw new Error(`STM32_Programmer_CLI failed: ${msg}`);
    }
  }
  throw new Error('No ST-Link flasher tool available (st-flash, ST-LINK_CLI.exe, or STM32_Programmer_CLI.exe).');
}

export async function readRegister({ addr, length = 4 }) {
  const address = parseIntHexOrDec(addr, 'addr');
  const size = parseIntHexOrDec(length, 'length');
  // st-flash --read <file> <address> <size> can dump memory to file; for MVP we read small length to temp
  if (await isExecutable(ST_FLASH)) {
    const osTmp = process.env.TEMP || process.env.TMP || process.cwd();
    const tmpFile = path.join(osTmp, `stread_${Date.now()}_${Math.random().toString(16).slice(2)}.bin`);
    try {
      const { stdout, stderr } = await execFileAsync(ST_FLASH, ['read', tmpFile, '0x' + address.toString(16), String(size)], { windowsHide: true });
      // Load the tmp file contents
      const data = await (await import('node:fs/promises')).readFile(tmpFile);
      return { tool: 'st-flash', bytes: Array.from(data.values()) };
    } catch (e) {
      const msg = e?.stderr || e?.stdout || e?.message || String(e);
      throw new Error(`st-flash read failed: ${msg}`);
    } finally {
      try { await (await import('node:fs/promises')).unlink(tmpFile); } catch {}
    }
  }
  // Try STM32_Programmer_CLI.exe dump: -c port=SWD -d <file> <addr> <size>
  if (await isExecutable(STM32_PROGRAMMER_CLI)) {
    const osTmp = process.env.TEMP || process.env.TMP || process.cwd();
    const tmpFile = path.join(osTmp, `stread_${Date.now()}_${Math.random().toString(16).slice(2)}.bin`);
    try {
      const args = ['-c', 'port=SWD', '-d', tmpFile, '0x' + address.toString(16), String(size)];
      const { stdout, stderr } = await execFileAsync(STM32_PROGRAMMER_CLI, args, { windowsHide: true });
      const data = await (await import('node:fs/promises')).readFile(tmpFile);
      return { tool: 'STM32_Programmer_CLI', bytes: Array.from(data.values()) };
    } catch (e) {
      const msg = e?.stderr || e?.stdout || e?.message || String(e);
      throw new Error(`STM32_Programmer_CLI read failed: ${msg}`);
    } finally {
      try { await (await import('node:fs/promises')).unlink(tmpFile); } catch {}
    }
  }
  // ST-LINK_CLI.exe: no simple direct memory dump CLI without scripts; skip for MVP
  throw new Error('readRegister requires st-flash or STM32_Programmer_CLI. Install one and set env path.');
}

export async function writeRegister({ addr, value }) {
  const address = parseIntHexOrDec(addr, 'addr');
  const val = parseIntHexOrDec(value, 'value');
  // st-flash write is for images; for a single register write we can use st-util + GDB
  // MVP: not trivial without GDB scripting; provide clear guidance
  throw new Error('writeRegister via CLI is not directly supported without GDB scripting. Use debug session + GDB to set memory.');
}

export async function resetDevice() {
  // st-flash reset
  if (await isExecutable(ST_FLASH)) {
    try {
      const { stdout, stderr } = await execFileAsync(ST_FLASH, ['reset'], { windowsHide: true });
      return { tool: 'st-flash', stdout, stderr };
    } catch (e) {
      const msg = e?.stderr || e?.stdout || e?.message || String(e);
      throw new Error(`st-flash reset failed: ${msg}`);
    }
  }
  // ST-LINK_CLI.exe -Rst
  if (await isExecutable(ST_LINK_CLI)) {
    try {
      const { stdout, stderr } = await execFileAsync(ST_LINK_CLI, ['-Rst'], { windowsHide: true });
      return { tool: 'ST-LINK_CLI', stdout, stderr };
    } catch (e) {
      const msg = e?.stderr || e?.stdout || e?.message || String(e);
      throw new Error(`ST-LINK_CLI reset failed: ${msg}`);
    }
  }
  // STM32_Programmer_CLI.exe -c port=SWD -rst
  if (await isExecutable(STM32_PROGRAMMER_CLI)) {
    try {
      const { stdout, stderr } = await execFileAsync(STM32_PROGRAMMER_CLI, ['-c', 'port=SWD', '-rst'], { windowsHide: true });
      return { tool: 'STM32_Programmer_CLI', stdout, stderr };
    } catch (e) {
      const msg = e?.stderr || e?.stdout || e?.message || String(e);
      throw new Error(`STM32_Programmer_CLI reset failed: ${msg}`);
    }
  }
  throw new Error('No ST-Link reset tool available (st-flash or ST-LINK_CLI.exe).');
}

export async function startDebug({ port = 4242 } = {}) {
  if (stUtilProc) return { message: `st-util already running on :${gdbPort}` };
  if (!(await isExecutable(ST_UTIL))) {
    throw new Error('st-util not found. Please install STM32 open-source tools (st-util).');
  }
  return await new Promise((resolve, reject) => {
    gdbPort = port || 4242;
    const args = ['-p', String(gdbPort)];
    const child = spawn(ST_UTIL, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let started = false;
    const onData = (data) => {
      const text = String(data);
      if (!started && /Listening at|gdbserver/i.test(text)) {
        started = true;
        stUtilProc = child;
        cleanup();
        resolve({ message: `st-util started on :${gdbPort}` });
      }
    };
    const onError = (err) => {
      cleanup();
      reject(new Error(`st-util failed to start: ${err?.message || err}`));
    };
    const onExit = (code) => {
      cleanup();
      if (!started) reject(new Error(`st-util exited with code ${code}`));
    };
    function cleanup() {
      child.stdout?.off('data', onData);
      child.stderr?.off('data', onData);
      child.off('error', onError);
      child.off('exit', onExit);
    }
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

export async function stopDebug() {
  if (!stUtilProc) return { message: 'st-util not running' };
  return await new Promise((resolve) => {
    const child = stUtilProc;
    stUtilProc = null;
    try {
      child.once('exit', () => resolve({ message: 'st-util stopped' }));
      child.kill('SIGTERM');
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
      }, 1500);
    } catch {
      resolve({ message: 'st-util terminated' });
    }
  });
}

// ----------------------
// GDB helper operations
// ----------------------

import net from 'node:net';

async function gdbCommand(cmd) {
  if (!stUtilProc) throw new Error('Debug server not running. Start with st.startDebug first.');
  return await new Promise((resolve, reject) => {
    const client = new net.Socket();
    const chunks = [];
    client.setNoDelay(true);
    client.connect(gdbPort, '127.0.0.1', () => {
      client.write(cmd.trim() + '\n');
      // Ask GDB for prompt by sending empty command after
      client.write('\n');
    });
    client.on('data', (d) => chunks.push(Buffer.from(d)));
    client.on('error', (e) => { try { client.destroy(); } catch {} reject(e); });
    client.setTimeout(600);
    client.on('timeout', () => { try { client.end(); } catch {} resolve(Buffer.concat(chunks).toString('utf8')); });
    client.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

export async function setBreakpoint({ addr }) {
  if (addr == null) throw new Error('setBreakpoint requires addr');
  const out = await gdbCommand(`monitor break 0x${parseIntHexOrDec(addr, 'addr').toString(16)}`);
  return { ok: true, output: out };
}

export async function step() {
  const out = await gdbCommand('monitor step');
  return { ok: true, output: out };
}

export async function readVar({ name }) {
  if (!name) throw new Error('readVar requires name');
  // Use GDB eval print via monitor is not available; st-util supports monitor read/write regs/mem.
  // As a simple MVP, attempt to evaluate symbol via GDB 'print' which requires a GDB session.
  // Here we try a naive approach: send 'print name'. Many st-util builds expect a real GDB client.
  const out = await gdbCommand(`print ${name}`);
  return { ok: true, output: out };
}

