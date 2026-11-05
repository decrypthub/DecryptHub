/** Stdio fixture reports the actual process workspace without accessing a browser or device. */
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'

serveStdio(() => {
  const server = new McpServer({ name: 'decrypthub-workspace-fixture', version: '1.0.0' })
  server.registerTool('workspace', { inputSchema: z.object({}) }, async () => ({
    content: [{ type: 'text', text: JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }) }],
  }))
  return server
})
