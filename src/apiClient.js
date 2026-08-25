const DEFAULT_API_BASE = 'http://localhost:5000'

export function getApiBaseUrl() {
  const envUrl = import.meta.env?.VITE_API_URL
  if (typeof envUrl === 'string' && envUrl.trim()) {
    return envUrl.replace(/\/$/, '')
  }
  return DEFAULT_API_BASE
}

export async function fetchJson(path, options = {}) {
  const url = `${getApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.error || data.message || 'Request failed')
  }

  return data
}
