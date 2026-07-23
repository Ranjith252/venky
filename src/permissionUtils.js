const DIGITS_ONLY = /\D/g

export function resolvePermissionSyncConfig(env = import.meta.env || {}) {
  const url = env.VITE_PERMISSION_SYNC_URL || '/api/permissions'
  const secret = env.VITE_PERMISSION_SYNC_SECRET
  return {
    url,
    headers: secret ? { 'x-permission-secret': secret } : {},
  }
}

export function normalizePhoneKey(phone) {
  const digits = String(phone || '')
    .trim()
    .replace(DIGITS_ONLY, '')

  if (!digits) return ''
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2)
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1)
  return digits
}

export function comparePasswordValue(input, stored) {
  return String(input || '').trim() === String(stored || '').trim()
}

export function normalizePhoneState(state) {
  const permittedPhones = Array.isArray(state?.permittedPhones)
    ? state.permittedPhones.map((phone) => normalizePhoneKey(phone)).filter(Boolean)
    : []

  const permissionRequests = Array.isArray(state?.permissionRequests)
    ? state.permissionRequests
        .map((request) => {
          if (!request || typeof request !== 'object') return null
          const normalizedPhone = normalizePhoneKey(request.phone)
          if (!normalizedPhone) return null
          return { ...request, phone: normalizedPhone }
        })
        .filter(Boolean)
    : []

  const users = Object.entries(state?.users || {}).reduce((acc, [phone, password]) => {
    const normalizedPhone = normalizePhoneKey(phone)
    if (normalizedPhone) {
      acc[normalizedPhone] = password
    }
    return acc
  }, {})

  return { ...state, permittedPhones, permissionRequests, users }
}

export function revokePhoneAccess(state, phone) {
  const normalizedPhone = normalizePhoneKey(phone)
  if (!normalizedPhone) return state

  const permittedPhones = (state.permittedPhones || []).filter(
    (entry) => normalizePhoneKey(entry) !== normalizedPhone
  )

  const permissionRequests = (state.permissionRequests || []).filter(
    (entry) => normalizePhoneKey(entry?.phone) !== normalizedPhone
  )

  const users = { ...(state.users || {}) }
  delete users[normalizedPhone]

  return { ...state, permittedPhones, permissionRequests, users }
}

export async function loadPermissionSharedState() {
  if (typeof window === 'undefined') return null

  try {
    const { url, headers } = resolvePermissionSyncConfig(import.meta.env || {})
    const response = await fetch(url, { cache: 'no-store', headers })
    if (!response.ok) return null
    const payload = await response.json()
    if (!payload || typeof payload !== 'object') return null
    return normalizePhoneState(payload)
  } catch (e) {
    return null
  }
}

export async function savePermissionSharedState(state) {
  if (typeof window === 'undefined') return false

  try {
    const payload = normalizePhoneState(state)
    const { url, headers } = resolvePermissionSyncConfig(import.meta.env || {})
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
      cache: 'no-store',
    })
    return response.ok
  } catch (e) {
    return false
  }
}
