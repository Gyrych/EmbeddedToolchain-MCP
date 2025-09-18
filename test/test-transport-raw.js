import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function main() {
  // Create transport that spawns the server process and pipes stderr
  const transport = new StdioClientTransport({ command: 'node', args: ['./index.js'], env: {}, stderr: 'pipe' });

  transport.onerror = (err) => console.error('Transport error:', err);
  const serverStderr = transport.stderr;
  if (serverStderr) serverStderr.on('data', d => process.stderr.write(`[server-stderr] ${d.toString()}`));

  transport.onmessage = (msg) => {
    console.log('[onmessage]', JSON.stringify(msg));
  };

  await transport.start();
  console.log('Transport started, pid:', transport.pid);

  // Send tools/list
  await transport.send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

  // Send tools/call listPorts
  await transport.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'listPorts', arguments: {} } });

  // Wait briefly to receive responses
  await new Promise(resolve => setTimeout(resolve, 1000));

  await transport.close();
  console.log('Transport closed');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
