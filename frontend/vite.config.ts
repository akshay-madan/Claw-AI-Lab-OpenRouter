import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { execFile } from 'node:child_process'
import path from 'node:path'

const resourcePort = process.env.RESOURCE_MONITOR_PORT || '8905'
const agentPort = process.env.AGENT_BRIDGE_PORT || '8906'

// Start / stop the backend (agent bridge + resource monitor) from the UI.
// The frontend itself keeps running so the page can start things again.
// Fixed commands only, and only for requests from this machine.
function systemControl(): Plugin {
  const startScript = path.resolve(__dirname, '..', 'start.sh')
  const commands: Record<string, string> = { start: 'start', stop: 'stop-backend' }
  return {
    name: 'claw-system-control',
    configureServer(server) {
      server.middlewares.use('/api/system', (req, res) => {
        const action = (req.url || '').replace(/^\//, '').split('?')[0]
        const remote = req.socket.remoteAddress || ''
        const isLocal = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)
        const send = (code: number, body: object) => {
          res.statusCode = code
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(body))
        }
        if (req.method !== 'POST' || !commands[action]) return send(404, { ok: false, error: 'unknown action' })
        if (!isLocal) return send(403, { ok: false, error: 'only allowed from this computer' })
        execFile('bash', [startScript, commands[action]], { cwd: path.dirname(startScript), timeout: 60_000 },
          (err, stdout, stderr) => send(err ? 500 : 200, { ok: !err, output: `${stdout}${stderr}` }))
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), systemControl()],
  server: {
    proxy: {
      '/ws/resources': {
        target: `ws://localhost:${resourcePort}`,
        ws: true,
        rewriteWsOrigin: true,
        rewrite: () => '/',
      },
      '/ws/agents': {
        target: `ws://localhost:${agentPort}`,
        ws: true,
        rewriteWsOrigin: true,
        rewrite: () => '/',
      },
      '/download': {
        target: `http://localhost:${agentPort}`,
        changeOrigin: true,
      },
    },
  },
})
