// compiler.js
// Encapsulates build operations for STM32 projects on Windows.
// Supports building via Makefile (make) or STM32CubeIDE CLI when available.
// Exposes compile({ target, cwd, tool }): runs the appropriate build command and returns logs.
// - target: optional make target (e.g., all, clean)
// - cwd: working directory of the project (defaults to process.cwd())
// - tool: 'make' (default) or 'cubeide'

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';

const execAsync = promisify(exec);

async function fileExists(p) {
  try { await access(p, fsConstants.F_OK); return true; } catch { return false; }
}

async function detectCubeIDE() {
  // Try environment override first
  const envPath = process.env.CUBEIDE_CLI;
  if (envPath && await fileExists(envPath)) return envPath;
  // Common default install paths (user may need to adjust)
  const candidates = [
    'C:/ST/STM32CubeIDE/stm32cubeide.exe',
    'C:/Program Files/STMicroelectronics/STM32Cube/STM32CubeIDE/stm32cubeide.exe',
  ];
  for (const c of candidates) {
    if (await fileExists(c)) return c;
  }
  return null;
}

export async function compile({ target = 'all', cwd = process.cwd(), tool = 'make', project = '' } = {}) {
  const runCwd = path.isAbsolute(cwd) ? cwd : path.resolve(process.cwd(), cwd);
  let cmd;
  if (tool === 'cubeide') {
    const cubeide = await detectCubeIDE();
    if (!cubeide) {
      throw new Error('STM32CubeIDE CLI not found. Set CUBEIDE_CLI env or install CubeIDE.');
    }
    // CubeIDE headless build example:
    // stm32cubeide.exe -nosplash -application org.eclipse.cdt.managedbuilder.core.headlessbuild \
    //   -data <workspaceDir> -import <projectDir> -cleanBuild <projectName>/<config>
    // For MVP, run a simple workspace build when project path is provided
    if (!project) throw new Error('cubeide build requires a project path or name in "project"');
    const workspace = runCwd; // use cwd as workspace
    const projectPath = path.isAbsolute(project) ? project : path.resolve(runCwd, project);
    // Import and build default config
    cmd = `"${cubeide}" -nosplash -application org.eclipse.cdt.managedbuilder.core.headlessbuild -data "${workspace}" -import "${projectPath}" -cleanBuild`;
  } else {
    // GNU make build
    // On Windows, users may need make from MSYS2/MinGW or GNUWin32 in PATH
    cmd = `make ${target}`.trim();
  }
  try {
    const { stdout, stderr } = await execAsync(cmd, { cwd: runCwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
    return { ok: true, tool, cmd, cwd: runCwd, stdout, stderr };
  } catch (e) {
    return { ok: false, tool, cmd, cwd: runCwd, stdout: e.stdout || '', stderr: e.stderr || e.message || String(e) };
  }
}

