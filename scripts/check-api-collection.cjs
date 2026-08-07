const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const jsonPath = path.join(root, 'api-testing/event-api.collection.json');
const ymlPath = path.join(root, 'api-testing/event-api.collection.yml');
const beforeJson = fs.readFileSync(jsonPath, 'utf8');
const beforeYml = fs.readFileSync(ymlPath, 'utf8');

execFileSync(process.execPath, [path.join(__dirname, 'generate-api-collection.cjs')], { cwd: root, stdio: 'pipe' });

const afterJson = fs.readFileSync(jsonPath, 'utf8');
const afterYml = fs.readFileSync(ymlPath, 'utf8');
if (afterJson !== beforeJson || afterYml !== beforeYml) {
  throw new Error('Generated API collections are out of date. Run node scripts/generate-api-collection.cjs.');
}

const collection = JSON.parse(afterJson);
const byPath = new Map();
for (const item of collection.item || []) {
  byPath.set(`${item.request.method} /${(item.request.url.path || []).join('/')}`, item);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function header(item, name) {
  return (item.request.header || []).find(h => h.key.toLowerCase() === name.toLowerCase());
}

const health = byPath.get('GET /health');
assert(health && health.request.auth.type === 'noauth', 'public /health must remain noauth');

const me = byPath.get('GET /auth/me');
assert(me && me.request.auth.type === 'bearer', 'default bearer routes must remain bearer auth');

const refresh = byPath.get('POST /auth/refresh');
assert(refresh && refresh.request.auth.type === 'noauth', '/auth/refresh must use cookie header, not bearer auth');
assert(header(refresh, 'Cookie')?.value === 'vsms_refresh={{refreshCookie}}; vsms_username={{username}}; vsms_csrf={{csrfToken}}', '/auth/refresh must send refresh, username, and CSRF cookies');
assert(header(refresh, 'X-CSRF-Token')?.value === '{{csrfToken}}', '/auth/refresh must include CSRF header');

const logout = byPath.get('POST /auth/logout');
assert(logout && logout.request.auth.type === 'noauth', '/auth/logout must use cookie header, not bearer auth');
assert(header(logout, 'Cookie')?.value === 'vsms_csrf={{csrfToken}}', '/auth/logout must send CSRF cookie when CSRF header is present');
assert(header(logout, 'X-CSRF-Token')?.value === '{{csrfToken}}', '/auth/logout must include CSRF header');

const globalLogout = byPath.get('POST /auth/global-logout');
assert(globalLogout && globalLogout.request.auth.type === 'noauth', '/auth/global-logout must use access cookie header, not bearer auth');
assert(header(globalLogout, 'Cookie')?.value === 'vsms_access={{accessCookie}}; vsms_csrf={{csrfToken}}', '/auth/global-logout must send access and CSRF cookies');

console.log('API collection parity and auth semantics passed');
