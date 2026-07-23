export function normalizePhoneKey(phone) {
  return String(phone || '').trim()
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
