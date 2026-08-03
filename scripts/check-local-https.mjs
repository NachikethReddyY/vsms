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
      response.on('end', () => resolve(response.statusCode))
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

assert.equal(await request('https://localhost:5173/'), 200)
assert.equal(await request('https://127.0.0.1:5000/health'), 200)
assert.equal(await request('https://localhost:5173/api/v1/users'), 401)
await Promise.all([
  rejectsPlainHttp('http://localhost:5173/'),
  rejectsPlainHttp('http://127.0.0.1:5000/health'),
])

console.log('HTTPS-only smoke check passed')
