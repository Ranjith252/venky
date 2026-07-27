import test from 'node:test'
import assert from 'node:assert/strict'
import { comparePasswordValue, loadPermissionSharedState, mergeSharedState, normalizePhoneState, normalizeSharedState, removeExamFromState, revokePhoneAccess, savePermissionSharedState } from './src/permissionUtils.js'
import { getStorageConfig } from './api/storage.js'

test('revokePhoneAccess removes a phone from access, requests, and user records', () => {
  const input = {
    permittedPhones: ['9999999999', '8888888888'],
    permissionRequests: [{ phone: '9999999999', otp: '123456' }],
    users: { '9999999999': 'secret1', '8888888888': 'secret2' }
  }

  const result = revokePhoneAccess(input, '9999999999')

  assert.deepEqual(result.permittedPhones, ['8888888888'])
  assert.deepEqual(result.permissionRequests, [])
  assert.deepEqual(result.users, { '8888888888': 'secret2' })
})

test('normalizePhoneState matches phones even when formatting differs', () => {
  const result = normalizePhoneState({
    permittedPhones: ['+91 98765 43210', '9876543211'],
    permissionRequests: [{ phone: '98765-43210', otp: '123456' }],
    users: { '+91 98765 43210': 'secret' }
  })

  assert.deepEqual(result.permittedPhones, ['9876543210', '9876543211'])
  assert.deepEqual(result.permissionRequests, [{ phone: '9876543210', otp: '123456' }])
  assert.deepEqual(result.users, { '9876543210': 'secret' })
})

test('normalizeSharedState keeps shared quiz data and normalizes phone records', () => {
  const result = normalizeSharedState({
    permittedPhones: ['+91 98765 43210'],
    permissionRequests: [{ phone: '98765-43210', otp: '123456' }],
    users: { '+91 98765 43210': 'secret' },
    questions: [{ question: 'What is 2+2?', options: ['3', '4', '5', '6'], answer: 1 }],
    exams: { exam1: { title: 'Midterm' } },
    adminPassword: 'Admin@123',
  })

  assert.deepEqual(result.permittedPhones, ['9876543210'])
  assert.deepEqual(result.permissionRequests, [{ phone: '9876543210', otp: '123456' }])
  assert.deepEqual(result.users, { '9876543210': 'secret' })
  assert.equal(result.questions.length, 1)
  assert.equal(result.exams.exam1.title, 'Midterm')
  assert.equal(result.adminPassword, 'Admin@123')
})

test('mergeSharedState preserves local quiz data when the remote snapshot is partial', () => {
  const merged = mergeSharedState(
    {
      permittedPhones: ['9876543210'],
      permissionRequests: [],
      users: { '9876543210': 'secret' },
      questions: [{ id: 1, question: 'Local question', options: ['A', 'B', 'C', 'D'], answer: 1 }],
      exams: {},
      studyNotes: [],
      studySubjects: [],
      notifications: [],
      notificationRecipients: [],
      desktopNotificationsEnabled: false,
      videos: [],
      adminPassword: 'Admin@123',
      quizTitle: 'Local Quiz',
    },
    {
      permittedPhones: ['9999999999'],
      permissionRequests: [{ phone: '9999999999', otp: '111111' }],
      users: { '9999999999': 'remote' },
      questions: [],
      exams: {},
      studyNotes: [],
      studySubjects: [],
      notifications: [],
      notificationRecipients: [],
      desktopNotificationsEnabled: false,
      videos: [],
      adminPassword: '',
      quizTitle: '',
    }
  )

  assert.deepEqual(merged.permittedPhones, ['9876543210', '9999999999'])
  assert.equal(merged.questions.length, 1)
  assert.equal(merged.questions[0].question, 'Local question')
  assert.equal(merged.users['9876543210'], 'secret')
  assert.equal(merged.users['9999999999'], 'remote')
  assert.equal(merged.adminPassword, 'Admin@123')
  assert.equal(merged.quizTitle, 'Local Quiz')
})

test('getStorageConfig uses Supabase when credentials are configured', () => {
  const config = getStorageConfig({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'secret',
    SUPABASE_TABLE: 'app_state',
  })

  assert.equal(config.kind, 'supabase')
  assert.equal(config.url, 'https://example.supabase.co')
  assert.equal(config.table, 'app_state')
})

test('loadPermissionSharedState preserves questions and exams from the shared payload', async () => {
  const originalFetch = global.fetch
  let capturedUrl = ''
  global.fetch = async (url) => {
    capturedUrl = String(url)
    return {
      ok: true,
      json: async () => ({
        permittedPhones: ['9876543210'],
        permissionRequests: [],
        users: { '9876543210': 'secret' },
        questions: [{ id: 1, question: 'What is 2+2?', options: ['3', '4', '5', '6'], answer: 1 }],
        exams: { exam1: { title: 'Midterm' } },
      }),
    }
  }

  try {
    const state = await loadPermissionSharedState()
    assert.equal(state.questions[0].question, 'What is 2+2?')
    assert.equal(state.exams.exam1.title, 'Midterm')
    assert.match(capturedUrl, /\/api\/permissions$/)
  } finally {
    global.fetch = originalFetch
  }
})

test('savePermissionSharedState keeps questions and exams in the payload', async () => {
  const originalFetch = global.fetch
  let capturedBody = ''
  global.fetch = async (_url, options) => {
    capturedBody = options.body
    return { ok: true }
  }

  try {
    const ok = await savePermissionSharedState({
      permittedPhones: ['9876543210'],
      permissionRequests: [],
      users: { '9876543210': 'secret' },
      questions: [{ id: 1, question: 'Test', options: ['A', 'B', 'C', 'D'], answer: 0 }],
      exams: { exam1: { title: 'Midterm' } },
      adminPassword: 'Admin@123',
      quizTitle: 'My Quiz',
      studyNotes: [],
      studySubjects: [],
      notifications: [],
      notificationRecipients: [],
      desktopNotificationsEnabled: false,
      videos: [],
    })

    assert.equal(ok, true)
    assert.match(capturedBody, /"questions"/)
    assert.match(capturedBody, /"exams"/)
  } finally {
    global.fetch = originalFetch
  }
})

test('removeExamFromState removes the selected exam while keeping the rest', () => {
  const result = removeExamFromState({ exams: { '2026-07-26': { title: 'A' }, '2026-07-27': { title: 'B' } } }, '2026-07-26')

  assert.deepEqual(result.exams, { '2026-07-27': { title: 'B' } })
})

test('comparePasswordValue trims whitespace before comparing passwords', () => {
  assert.equal(comparePasswordValue('  Venky@2025  ', 'Venky@2025'), true)
  assert.equal(comparePasswordValue('student123', ' student123 '), true)
  assert.equal(comparePasswordValue('wrong', 'student123'), false)
})
