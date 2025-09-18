// openocd.js
// Provides OpenOCD-based operations by invoking the openocd CLI.
// Exposes: startDebug, stopDebug, flashFirmware, resetDevice, readRegister, version

import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';

const execFileAsync = promisify(execFile);

let openocdProc = null;
let gdbPort = 3333;

function resolveOpenOcd() {
  return process.env.OPENOCD_PATH || 'openocd';
}

async function isExecutable(cmd) {
  const looksLikePath = /[\\/]/.test(cmd) || /\.exe$/i.test(cmd);
  if (looksLikePath) {
    try { await access(cmd, fsConstants.F_OK); return true; } catch { return false; }
  }
  try {
    await execFileAsync(cmd, ['-v'], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function buildArgs({ interface: iface, target, searchDir, speed, configFiles, extraCmds }) {
  const args = [];
  if (searchDir) args.push('-s', searchDir);
  if (Array.isArray(configFiles) && configFiles.length > 0) {
    for (const f of configFiles) args.push('-f', f);
  } else {
    if (iface) args.push('-f', `interface/${iface}.cfg`);
    if (target) args.push('-f', `target/${target}.cfg`);
  }
  if (speed) args.push('-c', `adapter speed ${speed}`);
  if (Array.isArray(extraCmds)) {
    for (const c of extraCmds) args.push('-c', c);
  }
  return args;
}

export async function version() {
  const bin = resolveOpenOcd();
  if (!(await isExecutable(bin))) throw new Error('openocd not found. Set OPENOCD_PATH or add to PATH.');
  const { stdout } = await execFileAsync(bin, ['-v'], { windowsHide: true });
  return { tool: 'openocd', stdout };
}

export async function startDebug({ interface: iface, target, searchDir, speed, configFiles, extraCmds, port = 3333 } = {}) {
  if (openocdProc) return { message: `openocd already running on :${gdbPort}` };
  const bin = resolveOpenOcd();
  if (!(await isExecutable(bin))) throw new Error('openocd not found. Set OPENOCD_PATH or add to PATH.');
  gdbPort = port || 3333;
  const args = buildArgs({ interface: iface, target, searchDir, speed, configFiles, extraCmds });
  // Force gdb port
  args.push('-c', `gdb_port ${gdbPort}`);
  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let started = false;
  return await new Promise((resolve, reject) => {
    const onData = (data) => {
      const text = String(data);
      if (!started && /listening on tcp|gdb/i.test(text)) {
        started = true;
        cleanup();
        openocdProc = child;
        resolve({ message: `openocd started on :${gdbPort}` });
      }
    };
    const onError = (err) => { cleanup(); reject(new Error(`openocd failed to start: ${err?.message || err}`)); };
    const onExit = (code) => { cleanup(); if (!started) reject(new Error(`openocd exited with code ${code}`)); };
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
  if (!openocdProc) return { message: 'openocd not running' };
  return await new Promise((resolve) => {
    const child = openocdProc;
    openocdProc = null;
    try {
      child.once('exit', () => resolve({ message: 'openocd stopped' }));
      child.kill('SIGTERM');
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 1500);
    } catch {
      resolve({ message: 'openocd terminated' });
    }
  });
}

export async function flashFirmware({ path: fwPath, addr, interface: iface, target, searchDir, speed, configFiles, extraCmds }) {
  if (typeof fwPath !== 'string' || fwPath.length === 0) throw new Error('Invalid firmware path');
  const bin = resolveOpenOcd();
  if (!(await isExecutable(bin))) throw new Error('openocd not found. Set OPENOCD_PATH or add to PATH.');
  const abs = path.isAbsolute(fwPath) ? fwPath : path.resolve(process.cwd(), fwPath);
  const args = buildArgs({ interface: iface, target, searchDir, speed, configFiles, extraCmds });
  const programCmd = addr ? `program ${JSON.stringify(abs)} verify reset 0x${parseInt(addr, addr.startsWith('0x') ? 16 : 10).toString(16)}; shutdown` : `program ${JSON.stringify(abs)} verify reset; shutdown`;
  args.push('-c', 'init');
  args.push('-c', programCmd);
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, { windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
    return { tool: 'openocd', stdout, stderr };
  } catch (e) {
    const msg = e?.stderr || e?.stdout || e?.message || String(e);
    throw new Error(`openocd program failed: ${msg}`);
  }
}

export async function resetDevice({ interface: iface, target, searchDir, speed, configFiles, extraCmds }) {
  const bin = resolveOpenOcd();
  if (!(await isExecutable(bin))) throw new Error('openocd not found. Set OPENOCD_PATH or add to PATH.');
  const args = buildArgs({ interface: iface, target, searchDir, speed, configFiles, extraCmds });
  args.push('-c', 'init');
  args.push('-c', 'reset run');
  args.push('-c', 'shutdown');
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, { windowsHide: true });
    return { tool: 'openocd', stdout, stderr };
  } catch (e) {
    const msg = e?.stderr || e?.stdout || e?.message || String(e);
    throw new Error(`openocd reset failed: ${msg}`);
  }
}

export async function readRegister({ addr, length = 4, interface: iface, target, searchDir, speed, configFiles, extraCmds }) {
  if (addr == null) throw new Error('addr required');
  const address = typeof addr === 'string' && addr.toLowerCase().startsWith('0x') ? parseInt(addr, 16) : parseInt(addr, 10);
  if (!Number.isFinite(address)) throw new Error('addr invalid');
  const size = typeof length === 'string' ? parseInt(length, 10) : length;
  const bin = resolveOpenOcd();
  if (!(await isExecutable(bin))) throw new Error('openocd not found. Set OPENOCD_PATH or add to PATH.');
  const args = buildArgs({ interface: iface, target, searchDir, speed, configFiles, extraCmds });
  const osTmp = process.env.TEMP || process.env.TMP || process.cwd();
  const tmpFile = path.join(osTmp, `ocdread_${Date.now()}_${Math.random().toString(16).slice(2)}.bin`);
  args.push('-c', 'init');
  args.push('-c', `dump_image ${JSON.stringify(tmpFile)} 0x${address.toString(16)} ${size}`);
  args.push('-c', 'shutdown');
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, { windowsHide: true });
    const data = await (await import('node:fs/promises')).readFile(tmpFile);
    return { tool: 'openocd', bytes: Array.from(data.values()) };
  } catch (e) {
    const msg = e?.stderr || e?.stdout || e?.message || String(e);
    throw new Error(`openocd read failed: ${msg}`);
  } finally {
    try { await (await import('node:fs/promises')).unlink(tmpFile); } catch {}
  }
}


