'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const ROOT = __dirname;
loadEnv(path.join(ROOT, '.env'));
const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const DATA_FILE = path.join(DATA_DIR, 'enquiries.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(48).toString('hex');
const BUSINESS = {
  phone: process.env.BUSINESS_PHONE || '',
  email: process.env.BUSINESS_EMAIL || '',
  whatsapp: (process.env.WHATSAPP_NUMBER || '').replace(/\D/g, ''),
  address: process.env.BUSINESS_ADDRESS || '',
  hours: process.env.BUSINESS_HOURS || ''
};
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL || BUSINESS.email;
const FROM_EMAIL = process.env.FROM_EMAIL || '';
const ALLOWED_SERVICES = new Set(['Flight bookings','Hotel reservations','Holiday packages','Local and international tours','Customised travel arrangements','Other enquiry']);
const sessions = new Map();
const rateBuckets = new Map();
let writeQueue = Promise.resolve();

if (IS_PROD && (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 16 || !SESSION_SECRET || SESSION_SECRET.length < 32)) {
  console.error('Production startup blocked: set ADMIN_PASSWORD (16+ characters) and SESSION_SECRET (32+ characters) in the hosting environment.');
  process.exit(1);
}
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]\n', { mode: 0o600 });

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}
function json(res, status, data, extra = {}) {
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', ...extra });
  res.end(JSON.stringify(data));
}
function text(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type':type, 'Cache-Control':'no-store', ...extra }); res.end(body);
}
function readBody(req, limit = 16000) {
  return new Promise((resolve, reject) => {
    let body = ''; let rejected = false;
    req.on('data', chunk => { body += chunk; if (Buffer.byteLength(body) > limit && !rejected) { rejected = true; reject(new Error('Request too large')); req.destroy(); } });
    req.on('end', () => { if (!rejected) { try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('Invalid JSON')); } } });
    req.on('error', reject);
  });
}
function clean(value, max = 1000) { return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max); }
function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= 254; }
function getRecords() { const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); return Array.isArray(parsed) ? parsed : []; }
function appendRecord(record) {
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    const records = getRecords(); records.push(record);
    const temp = `${DATA_FILE}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
    await fs.promises.writeFile(temp, JSON.stringify(records, null, 2) + '\n', { mode: 0o600 });
    await fs.promises.rename(temp, DATA_FILE);
  });
  return writeQueue;
}
function deleteRecord(id) {
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    const records = getRecords(); const next = records.filter(row => row.id !== id);
    if (next.length === records.length) return false;
    const temp = `${DATA_FILE}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
    await fs.promises.writeFile(temp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    await fs.promises.rename(temp, DATA_FILE); return true;
  });
  return writeQueue;
}
function updateRecord(id, status, adminNotes) {
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    const records = getRecords(); const item = records.find(row => row.id === id);
    if (!item) return false;
    item.status = status; item.adminNotes = adminNotes; item.updatedAt = new Date().toISOString();
    const temp = `${DATA_FILE}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
    await fs.promises.writeFile(temp, JSON.stringify(records, null, 2) + '\n', { mode: 0o600 });
    await fs.promises.rename(temp, DATA_FILE); return true;
  });
  return writeQueue;
}
function rateLimit(key, max, windowMs) {
  const now = Date.now(); let bucket = rateBuckets.get(key);
  if (!bucket || now > bucket.resetAt) bucket = { count: 0, resetAt: now + windowMs };
  bucket.count++; rateBuckets.set(key, bucket);
  if (rateBuckets.size > 2000) for (const [k, v] of rateBuckets) if (now > v.resetAt) rateBuckets.delete(k);
  return { allowed: bucket.count <= max, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
}
function cookie(req, name) {
  const header = req.headers.cookie || '';
  const found = header.split(';').map(x => x.trim()).find(x => x.startsWith(name + '='));
  try { return found ? decodeURIComponent(found.slice(name.length + 1)) : ''; } catch { return ''; }
}
function cookieOptions() { return `Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${IS_PROD ? '; Secure' : ''}`; }
function signSession(token) { return crypto.createHmac('sha256', SESSION_SECRET).update(token).digest('hex'); }
function getSession(req) {
  const signed = cookie(req, 'jimnaya_session'); if (!signed) return null;
  const [token, signature] = signed.split('.');
  if (!token || !signature || !safeEqual(signature, signSession(token))) return null;
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) { sessions.delete(token); return null; }
  return { token, ...session };
}
function requireAdmin(req, res) {
  const session = getSession(req);
  if (!session) { json(res, 401, { error: 'Please sign in again.' }); return null; }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (origin) { try { if (new URL(origin).host !== host) { json(res, 403, { error: 'Request origin rejected.' }); return null; } } catch { json(res, 403, { error: 'Request origin rejected.' }); return null; } }
    if (!req.headers['x-csrf-token'] || !safeEqual(req.headers['x-csrf-token'], session.csrf)) { json(res, 403, { error: 'Security token expired. Refresh and try again.' }); return null; }
  }
  return session;
}
function safeEqual(a, b) {
  const aa = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
async function sendNotification(enquiry) {
  if (!RESEND_API_KEY || !NOTIFICATION_EMAIL || !FROM_EMAIL) return false;
  const subject = `New Jimnaya enquiry: ${enquiry.service}`;
  const lines = [
    `New travel enquiry received (${enquiry.id})`, '',
    `Name: ${enquiry.name}`, `Email: ${enquiry.email}`, `Phone: ${enquiry.phone || 'Not provided'}`,
    `Service: ${enquiry.service}`, `Destination: ${enquiry.destination || 'Not specified'}`,
    `Travel date: ${enquiry.travelDate || 'Not specified'}`, '', `Message:`, enquiry.message,
    '', `Received: ${enquiry.receivedAt}`
  ];
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to: [NOTIFICATION_EMAIL], reply_to: enquiry.email, subject, text: lines.join('\n') }),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
  return true;
}
function csvEscape(value) { const s = String(value ?? ''); return `"${s.replace(/"/g, '""')}"`; }
function publicConfig() { return { phone: BUSINESS.phone, email: BUSINESS.email, whatsapp: BUSINESS.whatsapp, address: BUSINESS.address, hours: BUSINESS.hours }; }
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.svg':'image/svg+xml', '.webp':'image/webp', '.ico':'image/x-icon', '.xml':'application/xml; charset=utf-8', '.txt':'text/plain; charset=utf-8' };

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  if (IS_PROD) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const ip = req.socket.remoteAddress || 'unknown';

  if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true });
  if (req.method === 'GET' && url.pathname === '/robots.txt') {
    const base = (process.env.PUBLIC_SITE_URL || '').replace(/\/$/, '');
    return text(res, 200, `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n${base ? `Sitemap: ${base}/sitemap.xml\n` : ''}`, 'text/plain; charset=utf-8', { 'Cache-Control':'public, max-age=3600' });
  }
  if (req.method === 'GET' && url.pathname === '/sitemap.xml') {
    const base = (process.env.PUBLIC_SITE_URL || '').replace(/\/$/, '');
    if (!base) return text(res, 404, 'Set PUBLIC_SITE_URL to enable the sitemap.');
    const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${base}/</loc></url><url><loc>${base}/privacy</loc></url><url><loc>${base}/terms</loc></url></urlset>`;
    return text(res, 200, xml, 'application/xml; charset=utf-8', { 'Cache-Control':'public, max-age=3600' });
  }
  if (req.method === 'GET' && url.pathname === '/api/public-config') return json(res, 200, publicConfig(), { 'Cache-Control':'public, max-age=300' });

  if (req.method === 'POST' && url.pathname === '/api/enquiries') {
    const limit = rateLimit(`enquiry:${ip}`, 5, 15 * 60 * 1000);
    if (!limit.allowed) return json(res, 429, { error: 'Too many enquiries from this connection. Please try again later.' }, { 'Retry-After': String(limit.retryAfter) });
    try {
      const body = await readBody(req);
      if (clean(body.companyWebsite, 200)) return json(res, 200, { ok: true }); // honeypot
      const enquiry = {
        id: crypto.randomUUID(), receivedAt: new Date().toISOString(),
        name: clean(body.name, 100), email: clean(body.email, 254).toLowerCase(),
        phone: clean(body.phone, 40), service: clean(body.service, 80),
        destination: clean(body.destination, 160), travelDate: clean(body.travelDate, 20),
        travellers: clean(body.travellers, 30), budget: clean(body.budget, 60),
        message: clean(body.message, 3000), status: 'new', adminNotes: ''
      };
      if (!enquiry.name || !validEmail(enquiry.email) || !ALLOWED_SERVICES.has(enquiry.service) || !enquiry.message || enquiry.message.length < 10) return json(res, 400, { error: 'Please provide your name, a valid email, a service and a message of at least 10 characters.' });
      if (enquiry.travelDate && (!/^\d{4}-\d{2}-\d{2}$/.test(enquiry.travelDate) || Number.isNaN(Date.parse(enquiry.travelDate)) || new Date(enquiry.travelDate).toISOString().slice(0,10) !== enquiry.travelDate || enquiry.travelDate < new Date().toISOString().slice(0,10))) return json(res, 400, { error: 'Please enter a valid future travel date.' });
      await appendRecord(enquiry);
      try { await sendNotification(enquiry); } catch (error) { console.error('Notification email failed:', error.message); }
      return json(res, 201, { ok: true, id: enquiry.id });
    } catch (error) { if (!res.headersSent) return json(res, error.message === 'Request too large' ? 413 : 400, { error: error.message === 'Request too large' ? 'Enquiry is too large.' : 'Please check the submitted information and try again.' }); }
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/login') {
    const limit = rateLimit(`login:${ip}`, 8, 15 * 60 * 1000);
    if (!limit.allowed) return json(res, 429, { error: 'Too many sign-in attempts. Try again later.' }, { 'Retry-After': String(limit.retryAfter) });
    try {
      const body = await readBody(req, 4000);
      if (!ADMIN_PASSWORD || !safeEqual(body.password || '', ADMIN_PASSWORD)) return json(res, 401, { error: 'Incorrect password.' });
      const token = crypto.randomBytes(32).toString('hex'); const csrf = crypto.randomBytes(24).toString('hex');
      sessions.set(token, { csrf, expiresAt: Date.now() + 8 * 60 * 60 * 1000 });
      return json(res, 200, { ok: true, csrf }, { 'Set-Cookie': `jimnaya_session=${encodeURIComponent(`${token}.${signSession(token)}`)}; ${cookieOptions()}` });
    } catch { return json(res, 400, { error: 'Invalid sign-in request.' }); }
  }
  if (url.pathname.startsWith('/api/admin/')) {
    const session = requireAdmin(req, res); if (!session) return;
    if (req.method === 'GET' && url.pathname === '/api/admin/enquiries') {
      const records = getRecords().sort((a,b) => b.receivedAt.localeCompare(a.receivedAt));
      return json(res, 200, { enquiries: records, csrf: session.csrf });
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/export.csv') {
      const records = getRecords(); const keys = ['id','receivedAt','status','name','email','phone','service','destination','travelDate','travellers','budget','message','adminNotes'];
      const output = [keys.join(','), ...records.map(row => keys.map(key => csvEscape(row[key])).join(','))].join('\r\n');
      res.writeHead(200, { 'Content-Type':'text/csv; charset=utf-8', 'Content-Disposition':'attachment; filename="jimnaya-enquiries.csv"', 'Cache-Control':'no-store' }); return res.end('\uFEFF' + output);
    }
    if (req.method === 'DELETE' && url.pathname.startsWith('/api/admin/enquiries/')) {
      const id = decodeURIComponent(url.pathname.split('/').pop());
      try { const deleted = await deleteRecord(id); return deleted ? json(res, 200, { ok: true }) : json(res, 404, { error: 'Enquiry not found.' }); }
      catch { return json(res, 500, { error: 'Could not delete this enquiry.' }); }
    }
    if (req.method === 'PATCH' && url.pathname.startsWith('/api/admin/enquiries/')) {
      try {
        const id = decodeURIComponent(url.pathname.split('/').pop()); const body = await readBody(req, 6000);
        const allowed = new Set(['new','contacted','quoted','confirmed','closed']);
        if (!allowed.has(body.status) || typeof body.adminNotes !== 'string') return json(res, 400, { error: 'Invalid enquiry update.' });
        const updated = await updateRecord(id, body.status, clean(body.adminNotes, 3000));
        if (!updated) return json(res, 404, { error: 'Enquiry not found.' });
        return json(res, 200, { ok: true });
      } catch { return json(res, 400, { error: 'Could not update this enquiry.' }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/logout') {
      sessions.delete(session.token); return json(res, 200, { ok: true }, { 'Set-Cookie': `jimnaya_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${IS_PROD ? '; Secure' : ''}` });
    }
    return json(res, 404, { error: 'Admin endpoint not found.' });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed.' }, { Allow: 'GET, HEAD, POST, PATCH' });
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return text(res, 400, 'Bad request'); }
  if (pathname.includes('\0')) return text(res, 400, 'Bad request');
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin') pathname = '/admin.html';
  if (pathname === '/privacy') pathname = '/privacy.html';
  if (pathname === '/terms') pathname = '/terms.html';
  const publicFiles = new Set(['/index.html','/styles.css','/script.js','/admin.html','/admin.css','/admin.js','/privacy.html','/terms.html','/robots.txt']);
  const isAsset = pathname.startsWith('/assets/') && !pathname.slice('/assets/'.length).includes('/') && !pathname.includes('..');
  if (pathname.split('/').some(part => part.startsWith('.')) || pathname.includes('..') || (!publicFiles.has(pathname) && !isAsset)) return text(res, 404, 'Not found');
  const file = path.resolve(ROOT, '.' + pathname);
  if (!file.startsWith(ROOT + path.sep)) return text(res, 403, 'Forbidden');
  fs.readFile(file, (error, content) => {
    if (error) return text(res, 404, 'Not found');
    res.writeHead(200, { 'Content-Type':mime[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=604800, immutable' : 'no-cache' });
    if (req.method === 'HEAD') return res.end(); res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`Jimnaya is running on port ${PORT} (${NODE_ENV}).`);
  if (!ADMIN_PASSWORD) console.warn('Admin dashboard disabled until ADMIN_PASSWORD is configured.');
  if (!RESEND_API_KEY || !NOTIFICATION_EMAIL || !FROM_EMAIL) console.warn('Email alerts are not configured. Enquiries will still be saved.');
  if (!BUSINESS.phone && !BUSINESS.email && !BUSINESS.whatsapp) console.warn('Business contact details are not configured; add verified details to .env.');
});
