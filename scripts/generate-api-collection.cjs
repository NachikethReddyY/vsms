const fs = require('fs');
const path = require('path');
const yaml = require('../backend/node_modules/js-yaml');

const root = path.join(__dirname, '..');
const specPath = path.join(root, 'backend/docs/openapi.yaml');
const spec = yaml.load(fs.readFileSync(specPath, 'utf8'));

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const statusText = {200:'OK',201:'Created',202:'Accepted',204:'No Content',302:'Found',400:'Bad Request',401:'Unauthorized',403:'Forbidden',404:'Not Found',409:'Conflict',410:'Gone',412:'Precondition Failed',422:'Unprocessable Entity',429:'Too Many Requests',500:'Internal Server Error',502:'Bad Gateway',503:'Service Unavailable'};
const semantic = new Map([
  ['POST /auth/refresh', {
    name: 'Refresh Cognito-backed browser session',
    description: 'Exchanges the HttpOnly Cognito refresh cookie and CSRF header for replacement auth/CSRF cookies. The JSON body contains user, expiresIn, and sessionExpiresIn only. It does not expose access tokens, refresh tokens, or CSRF values to JavaScript.',
    test: 'pm.test("refresh exchanges the Cognito refresh cookie without exposing browser tokens", function () {\n  pm.response.to.have.status(200);\n  const body = pm.response.json();\n  pm.expect(body.user).to.be.an("object");\n  pm.expect(body.sessionExpiresIn).to.be.a("number");\n  pm.expect(body).to.not.have.property("accessToken");\n  pm.expect(body).to.not.have.property("csrfToken");\n  pm.expect(body).to.not.have.property("refreshToken");\n});'
  }],
  ['POST /auth/logout', {description: 'Clears local browser auth and CSRF cookies. The CSRF header is optional so an expired access cookie can still be cleared.'}],
  ['POST /auth/global-logout', {description: 'Requires an auth cookie and CSRF header, revokes Cognito sessions globally, then clears local browser cookies.'}],
  ['GET /auth/me', {description: 'Uses the HttpOnly auth cookie to return the current staff identity. No bearer token response is required.'}]
]);
function stripBase(p){return p.replace(/^\/api\/v1(?=\/)/,'');}
function header(name, value='', description=''){return {key:name, value, description, type:'text'};}
function bodyFor(op){
  const json = op.requestBody && op.requestBody.content && op.requestBody.content['application/json'];
  if (!json) return undefined;
  return {mode:'raw', raw: JSON.stringify(exampleFor(json.schema || {}, new Set()), null, 2), options:{raw:{language:'json'}}};
}
function resolve(schema){
  if (!schema || !schema.$ref) return schema || {};
  return schema.$ref.split('/').slice(1).reduce((o,k)=>o && o[k], spec);
}
function exampleFor(schema, seen){
  schema = resolve(schema);
  if (!schema || seen.has(schema)) return {};
  seen.add(schema);
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum) return schema.enum[0];
  if (schema.allOf) return Object.assign({}, ...schema.allOf.map(s => exampleFor(s, seen)));
  if (schema.oneOf || schema.anyOf) return exampleFor((schema.oneOf || schema.anyOf)[0], seen);
  if (schema.type === 'array') return [exampleFor(schema.items || {}, seen)];
  if (schema.type === 'object' || schema.properties) {
    const out = {};
    for (const [k,v] of Object.entries(schema.properties || {})) out[k] = exampleFor(v, seen);
    return out;
  }
  if (schema.format === 'uuid') return '00000000-0000-4000-8000-000000000000';
  if (schema.format === 'date-time') return '2026-08-07T00:00:00.000Z';
  if (schema.format === 'date') return '2026-08-07';
  if (schema.type === 'integer' || schema.type === 'number') return schema.minimum || 0;
  if (schema.type === 'boolean') return true;
  return '';
}
function paramsFor(pathName, op){
  const all = [...(spec.paths[pathName].parameters || []), ...(op.parameters || [])].map(resolve);
  return all.filter(p=>p.in==='query').map(p=>({key:p.name, value: String(p.schema && (p.schema.default ?? exampleFor(p.schema, new Set())) || ''), description:p.description || '', disabled: !p.required}));
}
function effectiveSecurity(op){
  if (Array.isArray(op.security)) return op.security;
  return spec.security || [];
}
function securitySchemeNames(op){
  return effectiveSecurity(op).flatMap(requirement => Object.keys(requirement || {}));
}
function cookieHeaderForScheme(name){
  if (name === 'refreshCookie') return 'vsms_refresh={{refreshCookie}}; vsms_username={{username}}';
  if (name === 'accessCookie') return 'vsms_access={{accessCookie}}';
  const scheme = spec.components && spec.components.securitySchemes && spec.components.securitySchemes[name];
  return scheme && scheme.type === 'apiKey' && scheme.in === 'cookie' ? `${scheme.name}={{${name}}}` : '';
}
function requiresCsrfCookie(parameters){
  return parameters.some(p=>p.in==='header' && p.name.toLowerCase() === 'x-csrf-token');
}
function headersFor(pathName, op){
  const all = [...(spec.paths[pathName].parameters || []), ...(op.parameters || [])].map(resolve);
  const hs = all.filter(p=>p.in==='header').map(p=>header(p.name, p.name.toLowerCase().includes('csrf') ? '{{csrfToken}}' : p.name.toLowerCase() === 'origin' ? '{{origin}}' : '', p.description || ''));
  const cookieValues = securitySchemeNames(op).map(cookieHeaderForScheme).filter(Boolean);
  if (requiresCsrfCookie(all)) cookieValues.push('vsms_csrf={{csrfToken}}');
  if (cookieValues.length) hs.unshift(header('Cookie', cookieValues.join('; '), 'Required secure browser session cookies'));
  if (op.requestBody && op.requestBody.content && op.requestBody.content['application/json']) hs.unshift(header('Content-Type','application/json','JSON request body'));
  return hs;
}
function authFor(op){
  const security = effectiveSecurity(op);
  if (Array.isArray(security) && security.length === 0) return {type:'noauth'};
  const names = securitySchemeNames(op);
  const schemes = spec.components && spec.components.securitySchemes || {};
  if (names.some(name => schemes[name] && schemes[name].type === 'http' && schemes[name].scheme === 'bearer')) {
    return {type:'bearer', bearer:[{key:'token', value:'{{token}}', type:'string'}]};
  }
  if (names.some(name => schemes[name] && schemes[name].type === 'apiKey' && schemes[name].in === 'cookie')) return {type:'noauth'};
  return {type:'noauth'};
}
function eventsFor(key){
  const s = semantic.get(key);
  return s && s.test ? [{listen:'test', script:{type:'text/javascript', exec:s.test.split('\n')}}] : [];
}
function responseExamples(op, method, url, requestHeaders){
  return Object.entries(op.responses || {}).slice(0,3).map(([code,r])=>{
    const res = resolve(r);
    const json = res.content && res.content['application/json'];
    return {name:`${code} Response`, originalRequest:{method, header:requestHeaders, url}, status:statusText[code] || '', code:Number(code) || 0, header:[{key:'Content-Type', value:'application/json'}], body: json ? JSON.stringify(exampleFor(json.schema || {}, new Set()), null, 2) : ''};
  });
}
const items = [];
for (const [p,pathItem] of Object.entries(spec.paths)) {
  for (const m of METHODS) {
    const op = pathItem[m];
    if (!op) continue;
    const clean = stripBase(p);
    const key = `${m.toUpperCase()} ${clean}`;
    const sem = semantic.get(key) || {};
    const url = `{{baseUrl}}${clean}`;
    const request = {method:m.toUpperCase(), header:headersFor(p, op), auth:authFor(op), url:{raw:url, host:['{{baseUrl}}'], path:clean.split('/').filter(Boolean), query:paramsFor(p, op)}};
    const body = bodyFor(op); if (body) request.body = body;
    items.push({name: sem.name || op.summary || op.operationId, description: sem.description || op.description || '', event: eventsFor(key), request, response: responseExamples(op, m.toUpperCase(), url, request.header)});
  }
}
const description = 'Generated from backend/docs/openapi.yaml. Cognito owns refresh-token issuance and rotation; /auth/refresh exchanges the HttpOnly Cognito refresh cookie and CSRF header for replacement auth/CSRF cookies, while its JSON response contains user, expiresIn, and sessionExpiresIn only.';
const collection = {info:{name:'VSMS API (OpenAPI sync)', schema:'https://schema.getpostman.com/json/collection/v2.1.0/collection.json', description}, item:items};
fs.writeFileSync(path.join(root,'api-testing/event-api.collection.json'), JSON.stringify(collection,null,2)+'\n');
fs.writeFileSync(path.join(root,'api-testing/event-api.collection.yml'), yaml.dump(collection,{lineWidth:120,noRefs:true}));
console.log(`Generated ${items.length} OpenAPI operations`);
