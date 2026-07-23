import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const fs = require('fs')
const path = require('path')

const DATA_FILE = path.join(process.cwd(), 'data', 'permissions.json')

function ensureFile() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true })
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ permittedPhones: [], permissionRequests: [], users: {} }, null, 2))
  }
}

function readState() {
  ensureFile()
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
}

function writeState(state) {
  ensureFile()
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2))
}

export default function handler(req, res) {
  const secret = req.headers['x-permission-secret']
  const expectedSecret = process.env.VITE_PERMISSION_SYNC_SECRET

  if (expectedSecret && secret !== expectedSecret) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  if (req.method === 'GET') {
    res.status(200).json(readState())
    return
  }

  if (req.method === 'PUT') {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}')
        writeState(parsed)
        res.status(200).json({ ok: true })
      } catch (e) {
        res.status(400).json({ error: 'Invalid JSON' })
      }
    })
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}
