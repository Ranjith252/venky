import { readSharedState, writeSharedState } from './storage.js'

export default async function handler(req, res) {
  const secret = req.headers['x-permission-secret']
  const expectedSecret = process.env.VITE_PERMISSION_SYNC_SECRET

  if (expectedSecret && secret !== expectedSecret) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  if (req.method === 'GET') {
    const state = await readSharedState(process.env)
    res.status(200).json(state)
    return
  }

  if (req.method === 'PUT') {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body || '{}')
        const saved = await writeSharedState(parsed, process.env)
        res.status(saved ? 200 : 500).json({ ok: saved })
      } catch (e) {
        res.status(400).json({ error: 'Invalid JSON' })
      }
    })
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}
