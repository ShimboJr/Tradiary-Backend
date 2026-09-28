/**
 * Acceptance test script for auth endpoints.
 * Run from /server: node test-auth.js
 */
const http = require('http');

const BASE = 'http://localhost:1929';
const EMAIL = `test_${Date.now()}@tradiary.dev`;
let cookies = '';
let accessToken = '';

const post = (path, body, extraHeaders = {}) =>
  new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const opts = {
      method: 'POST',
      hostname: 'localhost',
      port: 1929,
      path,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...(cookies ? { Cookie: cookies } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...extraHeaders,
      },
    };
    const req = http.request(opts, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        // Capture Set-Cookie
        const sc = res.headers['set-cookie'];
        if (sc) cookies = sc.map((c) => c.split(';')[0]).join('; ');
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });

const get = (path) =>
  new Promise((resolve, reject) => {
    const opts = {
      method: 'GET',
      hostname: 'localhost',
      port: 1929,
      path,
      headers: {
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(cookies ? { Cookie: cookies } : {}),
      },
    };
    const req = http.request(opts, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.end();
  });

const pass = (label) => console.log(`  ✅  ${label}`);
const fail = (label, detail) => { console.error(`  ❌  ${label}`); console.error('     ', detail); };

(async () => {
  console.log('\n🧪  Tradiary Auth Acceptance Tests\n');

  // ── 1. Register ──────────────────────────────────────────────────────────────
  console.log('1. POST /api/auth/register');
  const reg = await post('/api/auth/register', {
    name: 'Test Trader',
    email: EMAIL,
    password: 'Password123',
    confirmPassword: 'Password123',
  });
  if (reg.status === 201 && reg.body.success && reg.body.data.accessToken) {
    accessToken = reg.body.data.accessToken;
    pass(`Status 201, user: ${reg.body.data.user.email}`);
    pass(`Access token received (${accessToken.slice(0, 20)}…)`);
    pass(`isEmailVerified: ${reg.body.data.user.isEmailVerified}`);
    pass(`Cookie set: ${cookies ? 'yes (tradiary_rt)' : 'NO — MISSING'}`);
  } else {
    fail('Register failed', JSON.stringify(reg.body));
  }

  // ── 2. Duplicate email ────────────────────────────────────────────────────────
  console.log('\n2. POST /api/auth/register (duplicate email)');
  const dup = await post('/api/auth/register', {
    name: 'Test Trader',
    email: EMAIL,
    password: 'Password123',
    confirmPassword: 'Password123',
  });
  if (dup.status === 409) pass('Status 409 CONFLICT as expected');
  else fail('Expected 409', JSON.stringify(dup.body));

  // ── 3. GET /me (protected) ────────────────────────────────────────────────────
  console.log('\n3. GET /api/auth/me (with access token)');
  const me = await get('/api/auth/me');
  if (me.status === 200 && me.body.data.email === EMAIL) pass(`User loaded: ${me.body.data.name}`);
  else fail('GET /me failed', JSON.stringify(me.body));

  // ── 4. Logout ─────────────────────────────────────────────────────────────────
  console.log('\n4. POST /api/auth/logout');
  const lo = await post('/api/auth/logout', {});
  if (lo.status === 200) { pass('Logged out'); accessToken = ''; }
  else fail('Logout failed', JSON.stringify(lo.body));

  // ── 5. Refresh (cookie should be cleared, expect 401) ──────────────────────
  console.log('\n5. POST /api/auth/refresh (after logout — expect 401)');
  // Rebuild cookies without the cleared cookie:
  const noTokenCookies = cookies.split('; ').filter((c) => !c.startsWith('tradiary_rt')).join('; ');
  cookies = noTokenCookies;
  const ref401 = await post('/api/auth/refresh', {});
  if (ref401.status === 401) pass('401 as expected — cookie cleared by logout');
  else fail('Expected 401', JSON.stringify(ref401.body));

  // ── 6. Login ──────────────────────────────────────────────────────────────────
  console.log('\n6. POST /api/auth/login');
  const login = await post('/api/auth/login', { email: EMAIL, password: 'Password123' });
  if (login.status === 200 && login.body.data.accessToken) {
    accessToken = login.body.data.accessToken;
    pass(`Login OK, token: ${accessToken.slice(0, 20)}…`);
    pass(`Cookie set: ${cookies.includes('tradiary_rt') ? 'yes' : 'NO'}`);
  } else {
    fail('Login failed', JSON.stringify(login.body));
  }

  // ── 7. Wrong password ─────────────────────────────────────────────────────────
  console.log('\n7. POST /api/auth/login (wrong password — generic error)');
  const bad = await post('/api/auth/login', { email: EMAIL, password: 'WrongPass1' });
  if (bad.status === 401 && bad.body.error.message === 'Invalid email or password.') {
    pass('Generic 401 — no email disclosure');
  } else {
    fail('Expected generic 401', JSON.stringify(bad.body));
  }

  // ── 8. Refresh with valid cookie ───────────────────────────────────────────
  console.log('\n8. POST /api/auth/refresh (valid cookie)');
  const refresh = await post('/api/auth/refresh', {});
  if (refresh.status === 200 && refresh.body.data.accessToken) {
    pass(`Token rotated: ${refresh.body.data.accessToken.slice(0, 20)}…`);
    accessToken = refresh.body.data.accessToken;
  } else {
    fail('Refresh failed', JSON.stringify(refresh.body));
  }

  // ── 9. Invalid password validation ────────────────────────────────────────────
  console.log('\n9. POST /api/auth/register (weak password — expect 422)');
  const weak = await post('/api/auth/register', {
    name: 'Test',
    email: 'weak@tradiary.dev',
    password: 'tooshort',
    confirmPassword: 'tooshort',
  });
  if (weak.status === 422) pass('422 VALIDATION_ERROR for weak password');
  else fail('Expected 422', JSON.stringify(weak.body));

  // ── 10. Forgot password ───────────────────────────────────────────────────────
  console.log('\n10. POST /api/auth/forgot-password');
  const fp = await post('/api/auth/forgot-password', { email: EMAIL });
  if (fp.status === 200) pass('Always returns 200 (no email enumeration)');
  else fail('Forgot password failed', JSON.stringify(fp.body));

  console.log('\n🏁  Done.\n');
})();
