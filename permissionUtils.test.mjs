import test from 'node:test'
import assert from 'node:assert/strict'
import { revokePhoneAccess } from './src/permissionUtils.js'

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
