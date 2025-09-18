// test/read-com24-sdk.js
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

async function main() {
  const client = new Client({ name: 'read-com24-sdk', version: '0.1.0' });
  const transport = new StdioClientTransport({ command: 'node', args: ['./index.js'], env: {}, stderr: 'pipe' });

  const err = transport.stderr;
  if (err) err.on('data', d => process.stderr.write(`[server-stderr] ${d.toString()}`));
  client.onerror = e => console.error('Client error:', e);
  transport.onerror = e => console.error('Transport error:', e);

  await client.connect(transport);

  const listRes = await client.callTool({ name: 'listPorts', arguments: {} }, CallToolResultSchema);
  console.log('listPorts:', JSON.stringify(listRes, null, 2));

  const openRes = await client.callTool({ name: 'openPort', arguments: { name: 'COM24', baudRate: 115200 } }, CallToolResultSchema);
  console.log('openPort:', JSON.stringify(openRes, null, 2));

  const readRes = await client.callTool({ name: 'read', arguments: { maxBytes: 1024, encoding: 'utf8', timeoutMs: 2000 } }, CallToolResultSchema);
  console.log('read:', JSON.stringify(readRes, null, 2));

  const closeRes = await client.callTool({ name: 'closePort', arguments: {} }, CallToolResultSchema);
  console.log('closePort:', JSON.stringify(closeRes, null, 2));

  await transport.close();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
