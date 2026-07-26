import fs from 'node:fs'
import path from 'node:path'

const DATA_FILE = path.join(process.cwd(), 'data', 'permissions.json')

function defaultState() {
  return {
    permittedPhones: [],
    permissionRequests: [],
    users: {},
    questions: [],
    exams: {},
    adminPassword: '',
    quizTitle: 'My Quiz',
    studyNotes: [],
    studySubjects: [],
    notifications: [],
    notificationRecipients: [],
    desktopNotificationsEnabled: false,
    videos: [],
  }
}

function ensureFile() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true })
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultState(), null, 2))
  }
}

export function readFileState() {
  ensureFile()
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
}

export function writeFileState(state) {
  ensureFile()
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2))
}

export function getStorageConfig(env = process.env) {
  const supabaseUrl = String(env.SUPABASE_URL || '').trim().replace(/\/$/, '')
  const supabaseKey = String(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || '').trim()
  const supabaseTable = String(env.SUPABASE_TABLE || 'app_state').trim()

  if (supabaseUrl && supabaseKey) {
    return {
      kind: 'supabase',
      url: supabaseUrl,
      key: supabaseKey,
      table: supabaseTable,
    }
  }

  return { kind: 'file' }
}

export async function readSharedState(env = process.env) {
  const config = getStorageConfig(env)

  if (config.kind === 'supabase') {
    try {
      const response = await fetch(`${config.url}/rest/v1/${config.table}?id=eq.shared_state&select=payload`, {
        headers: {
          apikey: config.key,
          Authorization: `Bearer ${config.key}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error(`Supabase read failed: ${response.status}`)
      }

      const rows = await response.json()
      const payload = rows?.[0]?.payload
      return payload && typeof payload === 'object' ? payload : defaultState()
    } catch (error) {
      return readFileState()
    }
  }

  return readFileState()
}

export async function writeSharedState(state, env = process.env) {
  const config = getStorageConfig(env)

  if (config.kind === 'supabase') {
    try {
      const tableUrl = `${config.url}/rest/v1/${config.table}`
      const headers = {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      }

      const existingResponse = await fetch(`${tableUrl}?id=eq.shared_state&select=id`, { headers })
      if (existingResponse.ok) {
        const existingRows = await existingResponse.json()
        if (Array.isArray(existingRows) && existingRows.length > 0) {
          const patchResponse = await fetch(`${tableUrl}?id=eq.shared_state`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ payload: state }),
          })
          if (!patchResponse.ok) {
            throw new Error(`Supabase patch failed: ${patchResponse.status}`)
          }
          return true
        }
      }

      const createResponse = await fetch(tableUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ id: 'shared_state', payload: state }),
      })

      if (!createResponse.ok) {
        throw new Error(`Supabase create failed: ${createResponse.status}`)
      }

      return true
    } catch (error) {
      writeFileState(state)
      return false
    }
  }

  writeFileState(state)
  return true
}
