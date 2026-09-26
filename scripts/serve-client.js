const path = require('node:path')
const { parseInteger } = require('../src/http')

const mode = process.argv[2]
if (mode !== 'dev' && mode !== 'preview') {
  throw new Error('Expected dev or preview mode.')
}

const port = parseInteger(process.env.PORT || '3000', 'PORT', 1, 65535)
const host = process.env.HOST || '127.0.0.1'
const apiUrl = `http://127.0.0.1:${port}`
const configFile = path.resolve(__dirname, '../client/vite.config.mjs')

async function apiIsRunning() {
  try {
    const response = await fetch(`${apiUrl}/api/v1/health`, { signal: AbortSignal.timeout(1000) })
    return response.ok && (await response.json()).status === 'ok'
  } catch {
    return false
  }
}

async function ensureApi() {
  if (await apiIsRunning()) {
    console.log(`Using archive API at ${apiUrl}/api/v1`)
    return null
  }

  const { createServer } = require('../src/server')
  const server = createServer()

  try {
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        server.off('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, host)
    })
  } catch (error) {
    if (error.code === 'EADDRINUSE' && await apiIsRunning()) {
      console.log(`Using archive API at ${apiUrl}/api/v1`)
      return null
    }
    throw error
  }

  console.log(`Archive API listening on http://${host}:${port}/api/v1`)
  return server
}

function closeApi(server) {
  return new Promise((resolve, reject) => {
    if (!server) return resolve()
    server.close((error) => error ? reject(error) : resolve())
  })
}

async function main() {
  const api = await ensureApi()
  let client

  try {
    const vite = await import('vite')
    const config = { configFile, configLoader: 'runner' }
    client = mode === 'dev' ? await vite.createServer(config) : await vite.preview(config)
    if (mode === 'dev') await client.listen()
    client.printUrls()
  } catch (error) {
    if (client) await client.close()
    await closeApi(api)
    throw error
  }

  let stopping = false
  async function stop() {
    if (stopping) return
    stopping = true
    try {
      await client.close()
      await closeApi(api)
    } catch (error) {
      console.error(error)
      process.exitCode = 1
    }
  }

  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
