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

export function normalizeSharedState(state) {
  const normalized = normalizePhoneState(state)
  return {
    ...normalized,
    questions: Array.isArray(state?.questions) ? state.questions : [],
    exams: state && typeof state === 'object' && state.exams && typeof state.exams === 'object' ? state.exams : {},
    adminPassword: typeof state?.adminPassword === 'string' ? state.adminPassword : '',
    quizTitle: typeof state?.quizTitle === 'string' ? state.quizTitle : 'My Quiz',
    studyNotes: Array.isArray(state?.studyNotes) ? state.studyNotes : [],
    studySubjects: Array.isArray(state?.studySubjects) ? state.studySubjects : [],
    notifications: Array.isArray(state?.notifications) ? state.notifications : [],
    notificationRecipients: Array.isArray(state?.notificationRecipients) ? state.notificationRecipients : [],
    desktopNotificationsEnabled: Boolean(state?.desktopNotificationsEnabled),
    videos: Array.isArray(state?.videos) ? state.videos : [],
  }
}

export function mergeSharedState(localState, remoteState) {
  const localNormalized = normalizeSharedState(localState)
  const remoteNormalized = normalizeSharedState(remoteState)

  const mergeArrays = (left, right) => {
    const combined = [...left, ...right]
    const seen = new Set()
    return combined.filter((item) => {
      const key = typeof item === 'object' && item && 'id' in item ? String(item.id) : JSON.stringify(item)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  const mergedQuestions = mergeArrays(localNormalized.questions || [], remoteNormalized.questions || [])
  const mergedStudyNotes = mergeArrays(localNormalized.studyNotes || [], remoteNormalized.studyNotes || [])
  const mergedStudySubjects = mergeArrays(localNormalized.studySubjects || [], remoteNormalized.studySubjects || [])
  const mergedNotifications = mergeArrays(localNormalized.notifications || [], remoteNormalized.notifications || [])
  const mergedRecipients = mergeArrays(localNormalized.notificationRecipients || [], remoteNormalized.notificationRecipients || [])
  const mergedVideos = mergeArrays(localNormalized.videos || [], remoteNormalized.videos || [])

  const permittedPhones = Array.from(new Set([...(localNormalized.permittedPhones || []), ...(remoteNormalized.permittedPhones || [])]))
  const permissionRequests = Array.from(new Map([...localNormalized.permissionRequests, ...remoteNormalized.permissionRequests].map((request) => [String(request.phone), request])).values())
  const users = { ...(remoteNormalized.users || {}), ...(localNormalized.users || {}) }
  const exams = { ...(remoteNormalized.exams || {}), ...(localNormalized.exams || {}) }

  return {
    ...localNormalized,
    ...remoteNormalized,
    permittedPhones,
    permissionRequests,
    users,
    exams,
    questions: mergedQuestions,
    studyNotes: mergedStudyNotes,
    studySubjects: mergedStudySubjects,
    notifications: mergedNotifications,
    notificationRecipients: mergedRecipients,
    videos: mergedVideos,
    adminPassword: localNormalized.adminPassword || remoteNormalized.adminPassword || '',
    quizTitle: localNormalized.quizTitle || remoteNormalized.quizTitle || 'My Quiz',
    desktopNotificationsEnabled: Boolean(localNormalized.desktopNotificationsEnabled || remoteNormalized.desktopNotificationsEnabled),
  }
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

export function removeExamFromState(state, examKey) {
  if (!examKey) return state

  const exams = { ...(state?.exams || {}) }
  delete exams[examKey]

  return { ...(state || {}), exams }
}

export async function loadPermissionSharedState() {
  if (typeof globalThis.fetch !== 'function') return null

  try {
    const { url, headers } = resolvePermissionSyncConfig(import.meta.env || {})
    const response = await fetch(url, { cache: 'no-store', headers })
    if (!response.ok) return null
    const payload = await response.json()
    if (!payload || typeof payload !== 'object') return null
    return normalizeSharedState(payload)
  } catch (e) {
    return null
  }
}

export async function savePermissionSharedState(state) {
  if (typeof globalThis.fetch !== 'function') return false

  try {
    const payload = normalizeSharedState(state)
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
