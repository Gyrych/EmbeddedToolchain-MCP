// test/read-com24-raw.js
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function main() {
  const transport = new StdioClientTransport({ command: 'node', args: ['./index.js'], env: {}, stderr: 'pipe' });
  transport.onerror = (e) => console.error('Transport error:', e);
  const serverStderr = transport.stderr;
  if (serverStderr) serverStderr.on('data', d => process.stderr.write(`[server-stderr] ${d.toString()}`));

  transport.onmessage = (msg) => {
    console.log('[onmessage]', JSON.stringify(msg));
  };

  await transport.start();
  console.log('Transport started, pid:', transport.pid);

  // initialize handshake (protocol expects initialize request)
  await transport.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'read-com24-raw', version: '0.1.0' } } });

  // Wait for init response
  await wait(200);

  // Call openPort for COM24
  await transport.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'openPort', arguments: { name: 'COM24', baudRate: 115200 } } });

  // Wait a bit to let port open
  await wait(500);

  // Read from port (timeoutMs 2000)
  await transport.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read', arguments: { maxBytes: 1024, encoding: 'utf8', timeoutMs: 2000 } } });

  // Close port
  await transport.send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'closePort', arguments: {} } });

  // Wait to receive responses
  await wait(1500);
  await transport.close();
  console.log('Transport closed');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
