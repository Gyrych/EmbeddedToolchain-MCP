import { spawn } from 'node:child_process';

// Spawn the MCP service from the repository root
const child = spawn(process.execPath, ['./index.js'], { stdio: ['pipe', 'pipe', 'inherit'] });

// Minimal MCP-like JSON request for testing: listPorts
const req = JSON.stringify({ jsonrpc: '2.0', method: 'listPorts', params: {}, id: 1 }) + '\n';

child.stdin.write(req, 'utf8');

// Collect stdout data
let outBuf = '';
child.stdout.on('data', (data) => {
  outBuf += data.toString();
  process.stdout.write(data);
});

child.on('exit', (code, signal) => {
  console.log('\nChild exited with', code, signal);
  process.exit(code === 0 ? 0 : 1);
});

// Fail-safe: after 3s, stop the child
setTimeout(() => {
  try { child.stdin.end(); } catch {}
  try { child.kill(); } catch {}
}, 3000);
