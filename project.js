// project.js
// Encapsulates project management: scaffolding, file operations, and Git integration.
// Exposes:
// - createProject({ template, path })
// - getFileList({ cwd })
// - readFile({ path })
// - writeFile({ path, content })
// - gitCommit({ message, cwd })
// - gitDiff({ cwd })

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function writeText(filePath, content) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, 'utf8');
}

export async function createProject({ template = 'bare', path: targetPath }) {
  if (!targetPath) throw new Error('createProject requires a target path');
  const abs = path.isAbsolute(targetPath) ? targetPath : path.resolve(process.cwd(), targetPath);
  await ensureDir(abs);

  // Minimal STM32 template (Makefile-based skeleton)
  if (template === 'bare') {
    const makefile = `# Minimal Makefile (customize for your STM32 toolchain)
TARGET := app
BUILD  := build
SRC    := src/main.c
CC     := arm-none-eabi-gcc
CFLAGS := -O0 -g3 -ffreestanding -nostdlib
LDFLAGS :=

all: $(BUILD)/$(TARGET).elf

$(BUILD)/$(TARGET).elf: $(SRC)
	@mkdir -p $(BUILD)
	$(CC) $(CFLAGS) -o $@ $^ $(LDFLAGS)

clean:
	rm -rf $(BUILD)
`;
    const mainC = `#include <stdint.h>

int main(void){
  while(1){}
}
`;
    await writeText(path.join(abs, 'Makefile'), makefile);
    await writeText(path.join(abs, 'src/main.c'), mainC);
    return { message: `Project created at ${abs}` };
  }
  throw new Error(`Unknown template: ${template}`);
}

export async function getFileList({ cwd = process.cwd() } = {}) {
  const abs = path.isAbsolute(cwd) ? cwd : path.resolve(process.cwd(), cwd);
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(entries.map(async (e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return await walk(full);
      return full;
    }));
    return files.flat();
  }
  const list = await walk(abs);
  return list.map((p) => path.relative(abs, p));
}

export async function readFile({ path: filePath, cwd = process.cwd() }) {
  if (!filePath) throw new Error('readFile requires a path');
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
  const data = await fs.readFile(abs, 'utf8');
  return { path: abs, content: data };
}

export async function writeFile({ path: filePath, content, cwd = process.cwd() }) {
  if (!filePath) throw new Error('writeFile requires a path');
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
  await ensureDir(path.dirname(abs));
  await fs.writeFile(abs, content ?? '', 'utf8');
  return { path: abs, bytes: Buffer.byteLength(content ?? '', 'utf8') };
}

export async function gitCommit({ message, cwd = process.cwd() }) {
  if (!message) throw new Error('gitCommit requires a message');
  const cmd = `git add -A && git commit -m ${JSON.stringify(message)}`;
  try {
    const { stdout, stderr } = await execAsync(cmd, { cwd, windowsHide: true });
    return { ok: true, stdout, stderr };
  } catch (e) {
    return { ok: false, stdout: e.stdout || '', stderr: e.stderr || e.message || String(e) };
  }
}

export async function gitDiff({ cwd = process.cwd() } = {}) {
  try {
    const { stdout, stderr } = await execAsync('git diff', { cwd, windowsHide: true });
    return { ok: true, stdout, stderr };
  } catch (e) {
    return { ok: false, stdout: e.stdout || '', stderr: e.stderr || e.message || String(e) };
  }
}

