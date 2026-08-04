import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'

const ca = fs.readFileSync(path.join(execFileSync('mkcert', ['-CAROOT'], { encoding: 'utf8' }).trim(), 'rootCA.pem'))

function request(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { ca }, (response) => {
      response.resume()
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers }))
    }).on('error', reject)
  })
}

function rejectsPlainHttp(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (response) => {
      response.resume()
      reject(new Error(`${url} returned HTTP ${response.statusCode}`))
    })
    req.setTimeout(2_000, () => req.destroy())
    req.on('error', resolve)
  })
}

assert.equal((await request('https://localhost:5173/')).status, 200)
const health = await request('https://127.0.0.1:5050/health')
assert.equal(health.status, 200)
assert.match(health.headers['content-security-policy'], /frame-ancestors 'none'/)
assert.equal(health.headers['permissions-policy'], 'camera=(), microphone=(), geolocation=()')
assert.equal((await request('https://localhost:5173/api/v1/users')).status, 401)
await Promise.all([
  rejectsPlainHttp('http://localhost:5173/'),
  rejectsPlainHttp('http://127.0.0.1:5050/health'),
])

console.log('HTTPS-only smoke check passed')
