// jlink.js
// Provides J-Link (SEGGER) operations using JLink.exe / JLinkExe and JLinkGDBServerCL.exe.
// Exposes: startDebug, stopDebug, flashFirmware, resetDevice, readRegister, version

import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';

const execFileAsync = promisify(execFile);

let gdbServerProc = null;
let gdbPort = 2331;

function resolveJlink() {
  return process.platform === 'win32' ? (process.env.JLINK_EXE_PATH || 'JLink.exe') : (process.env.JLINK_EXE_PATH || 'JLinkExe');
}

function resolveGdbServer() {
  return process.env.JLINK_GDB_SERVER_PATH || 'JLinkGDBServerCL.exe';
}

async function isExecutable(cmd) {
  const looksLikePath = /[\\/]/.test(cmd) || /\.exe$/i.test(cmd);
  if (looksLikePath) {
    try { await access(cmd, fsConstants.X_OK); return true; } catch { return false; }
  }
  try {
    await execFileAsync(cmd, ['-?', '-h'], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

export async function version() {
  const bin = resolveJlink();
  if (!(await isExecutable(bin))) throw new Error('J-Link CLI not found. Set JLINK_EXE_PATH or add to PATH.');
  const { stdout } = await execFileAsync(bin, ['-CommanderScript', '-'], { windowsHide: true, input: 'exit\n' });
  return { tool: 'jlink', stdout };
}

export async function startDebug({ device, if: iface = 'SWD', speed = 4000, port = 2331 } = {}) {
  if (gdbServerProc) return { message: `JLinkGDBServer already running on :${gdbPort}` };
  const gdbServer = resolveGdbServer();
  if (!(await isExecutable(gdbServer))) throw new Error('JLinkGDBServerCL.exe not found. Set JLINK_GDB_SERVER_PATH or add to PATH.');
  gdbPort = port || 2331;
  const args = ['-port', String(gdbPort)];
  if (device) args.push('-device', device);
  if (iface) args.push('-if', iface);
  if (speed) args.push('-speed', String(speed));
  const child = spawn(gdbServer, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let started = false;
  return await new Promise((resolve, reject) => {
    const onData = (data) => {
      const text = String(data);
      if (!started && /Listening on TCP port|Waiting for GDB connection/i.test(text)) {
        started = true;
        cleanup();
        gdbServerProc = child;
        resolve({ message: `JLinkGDBServer started on :${gdbPort}` });
      }
    };
    const onError = (err) => { cleanup(); reject(new Error(`JLinkGDBServer failed: ${err?.message || err}`)); };
    const onExit = (code) => { cleanup(); if (!started) reject(new Error(`JLinkGDBServer exited with code ${code}`)); };
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
  if (!gdbServerProc) return { message: 'JLinkGDBServer not running' };
  return await new Promise((resolve) => {
    const child = gdbServerProc;
    gdbServerProc = null;
    try {
      child.once('exit', () => resolve({ message: 'JLinkGDBServer stopped' }));
      child.kill('SIGTERM');
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 1500);
    } catch {
      resolve({ message: 'JLinkGDBServer terminated' });
    }
  });
}

export async function flashFirmware({ path: fwPath, device, if: iface = 'SWD', speed = 4000, addr }) {
  if (typeof fwPath !== 'string' || fwPath.length === 0) throw new Error('Invalid firmware path');
  const bin = resolveJlink();
  if (!(await isExecutable(bin))) throw new Error('J-Link CLI not found. Set JLINK_EXE_PATH or add to PATH.');
  const abs = path.isAbsolute(fwPath) ? fwPath : path.resolve(process.cwd(), fwPath);
  const script = [
    device ? `device ${device}` : null,
    `if ${iface}`,
    `speed ${speed}`,
    'r',
    addr ? `loadfile ${abs} ${addr}` : `loadfile ${abs}`,
    'r',
    'g',
    'exit'
  ].filter(Boolean).join('\n');
  try {
    const { stdout, stderr } = await execFileAsync(bin, ['-CommanderScript', '-'], { windowsHide: true, input: script });
    return { tool: 'jlink', stdout, stderr };
  } catch (e) {
    const msg = e?.stderr || e?.stdout || e?.message || String(e);
    throw new Error(`J-Link flash failed: ${msg}`);
  }
}

export async function resetDevice({ device, if: iface = 'SWD', speed = 4000 }) {
  const bin = resolveJlink();
  if (!(await isExecutable(bin))) throw new Error('J-Link CLI not found. Set JLINK_EXE_PATH or add to PATH.');
  const script = [
    device ? `device ${device}` : null,
    `if ${iface}`,
    `speed ${speed}`,
    'r',
    'g',
    'exit'
  ].filter(Boolean).join('\n');
  try {
    const { stdout, stderr } = await execFileAsync(bin, ['-CommanderScript', '-'], { windowsHide: true, input: script });
    return { tool: 'jlink', stdout, stderr };
  } catch (e) {
    const msg = e?.stderr || e?.stdout || e?.message || String(e);
    throw new Error(`J-Link reset failed: ${msg}`);
  }
}

export async function readRegister({ addr, length = 4, device, if: iface = 'SWD', speed = 4000 }) {
  // J-Link Commander does not provide a simple binary dump command; using mem read prints ASCII.
  // For MVP, read 32-bit register via mem32.
  if (addr == null) throw new Error('addr required');
  const bin = resolveJlink();
  if (!(await isExecutable(bin))) throw new Error('J-Link CLI not found. Set JLINK_EXE_PATH or add to PATH.');
  const script = [
    device ? `device ${device}` : null,
    `if ${iface}`,
    `speed ${speed}`,
    `mem32 ${addr} ${Math.max(1, Math.ceil((typeof length === 'string' ? parseInt(length, 10) : length) / 4))}`,
    'exit'
  ].filter(Boolean).join('\n');
  try {
    const { stdout } = await execFileAsync(bin, ['-CommanderScript', '-'], { windowsHide: true, input: script });
    return { tool: 'jlink', output: stdout };
  } catch (e) {
    const msg = e?.stderr || e?.stdout || e?.message || String(e);
    throw new Error(`J-Link read failed: ${msg}`);
  }
}


