import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ListToolsResultSchema, CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

async function main() {
  const client = new Client({ name: 'test-sdk-client', version: '0.1.0' });

  // Start server process via stdio transport and capture stderr
  const transport = new StdioClientTransport({ command: 'node', args: ['./index.js'], env: {}, stderr: 'pipe' });

  // Pipe server stderr to our process stderr for visibility
  const serverStderr = transport.stderr;
  if (serverStderr) {
    serverStderr.on('data', (chunk) => {
      process.stderr.write(`[server-stderr] ${chunk.toString()}`);
    });
  }

  transport.onerror = (err) => console.error('Transport error:', err);
  client.onerror = (err) => console.error('Client error:', err);

  try {
    await client.connect(transport);
    console.log('Connected to MCP server via StdioClientTransport');
    console.log('Transport pid:', transport.pid);

    // Wait briefly for server initialize to finish and for server info to populate
    await new Promise(resolve => setTimeout(resolve, 300));

    try {
      const sv = client.getServerVersion();
      console.log('Server version/info:', sv);
    } catch (e) {
      console.error('Error getting server version:', e);
    }

    // List tools (print full response for diagnostics)
    try {
      const toolsResp = await client.listTools({});
      console.log('tools/list full response:');
      console.log(JSON.stringify(toolsResp, null, 2));
    } catch (e) {
      console.error('Error listing tools:', e);
    }

    // Call listPorts via tools/call
    try {
      const res = await client.callTool({ name: 'listPorts', arguments: {} }, CallToolResultSchema);
      console.log('listPorts result:');
      console.log(JSON.stringify(res, null, 2));
    } catch (e) {
      console.error('Error calling listPorts:', e);
    }

    await transport.close();
    console.log('Transport closed');
  } catch (e) {
    console.error('Failed to connect or call tools:', e);
    process.exit(1);
  }
}

main();
