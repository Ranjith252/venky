import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizePhoneState, revokePhoneAccess } from './src/permissionUtils.js'

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
