import http from 'node:http';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, mkdirSync, chmodSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const root = new URL('./', import.meta.url);
const file = name => fileURLToPath(new URL(name, root));
process.umask(0o077);
mkdirSync(file('data/'), { recursive: true });
const db = new DatabaseSync(file('data/monitor.sqlite'));
db.exec(`PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS participants (attempt TEXT PRIMARY KEY, details TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS events (
    attempt TEXT NOT NULL, seq INTEGER NOT NULL, student TEXT NOT NULL,
    kind TEXT NOT NULL, observed TEXT NOT NULL, received TEXT NOT NULL,
    duration_ms INTEGER, PRIMARY KEY (attempt, seq));`);
chmodSync(file('data/monitor.sqlite'), 0o600);

if (process.argv.includes('--report')) {
  console.table(db.prepare(`SELECT student, details AS identity, events.attempt, seq, kind, observed, duration_ms
    FROM events LEFT JOIN participants USING (attempt) ORDER BY student, events.attempt, seq`).all());
  db.close();
  process.exit(0);
}

function fail(message) { console.error(message); process.exit(1); }
const form = URL.parse(process.env.FORM_URL || '');
if (form?.origin !== 'https://docs.google.com' || !/^\/forms\/d\/(?:e\/)?[\w-]+\/viewform\/?$/.test(form.pathname))
  fail('Set FORM_URL in .env to the full Google Forms respondent link ending in /viewform.');
// In the teacher's prefilled template each sample answer names its local input.
const identityFields = [...form.searchParams].filter(([key]) => /^entry\.\d+$/.test(key));
if (identityFields.length > 8 ||
    new Set(identityFields.map(([key]) => key)).size !== identityFields.length ||
    new Set(identityFields.map(([,label]) => label.trim())).size !== identityFields.length ||
    identityFields.some(([,label]) => !label.trim() || label.length > 50 || /[\x00-\x1f\x7f-\x9f]/u.test(label)))
  fail('Use distinct labels for up to eight short-answer identity fields in the prefilled URL.');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8000);
if (!Number.isInteger(port) || port < 1 || port > 65535) fail('PORT must be between 1 and 65535.');
db.prepare("INSERT OR IGNORE INTO settings VALUES ('secret', ?)").run(randomBytes(32).toString('hex'));
const secret = db.prepare("SELECT value FROM settings WHERE key='secret'").get().value;
const sign = text => createHmac('sha256', secret).update(text).digest('hex');
const classPath = '/q/' + sign('class:' + form.href).slice(0,32);
const template = readFileSync(file('index.html'), 'utf8');
const script = readFileSync(file('monitor.js'));
const allowed = new Set(['Session started','Entered fullscreen','Exited fullscreen','Page hidden','Page visible again','Session finished','Page closed']);
const insert = db.prepare('INSERT INTO events VALUES (?,?,?,?,?,?,?) ON CONFLICT(attempt,seq) DO NOTHING');

function respond(res, status, body = '', type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {'Content-Type': type, 'Cache-Control':'no-store', 'Referrer-Policy':'no-referrer',
    'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'});
  res.end(body);
}
function attr(value) {
  return value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
}
async function receive(req, res) {
  if (req.headers['content-type'] !== 'application/json') return respond(res,415);
  const auth = /^Bearer ([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(req.headers.authorization || '');
  if (!auth || !timingSafeEqual(Buffer.from(auth[2]), Buffer.from(sign(classPath + auth[1])))) return respond(res,403);
  let body = '';
  for await (const chunk of req) {
    body += chunk.toString('latin1');
    if (body.length > 4096) return respond(res,413);
  }
  let event;
  try { event = JSON.parse(Buffer.from(body,'latin1').toString('utf8')); } catch { return respond(res,400); }
  if (!event || !allowed.has(event.type) || !Number.isSafeInteger(event.seq) || event.seq < 1 ||
      typeof event.student !== 'string' || !event.student.trim() || event.student.length > 80 ||
      /[\u0000-\u001f\u007f-\u009f]/u.test(event.student) ||
      typeof event.timestamp !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(event.timestamp) ||
      !Number.isFinite(Date.parse(event.timestamp)) ||
      (event.type === 'Page visible again' && (!Number.isSafeInteger(event.durationMs) || event.durationMs < 0))) return respond(res,400);
  if (identityFields.length && event.seq === 1) {
    const values = event.identity;
    if (event.type !== 'Session started' || !Array.isArray(values) || values.length !== identityFields.length ||
        values.some(v => typeof v !== 'string' || !v.trim() || v.length > 80 || /[\x00-\x1f\x7f-\x9f]/u.test(v)) ||
        values[0] !== event.student) return respond(res,400);
    const details = Object.fromEntries(identityFields.map(([, label], i) => [label.trim(), values[i]]));
    db.prepare('INSERT OR IGNORE INTO participants VALUES (?,?)').run(auth[1], JSON.stringify(details));
  }
  insert.run(auth[1],event.seq,event.student,event.type,event.timestamp,new Date().toISOString(),
    event.type === 'Page visible again' ? event.durationMs : null);
  respond(res,204);
}

const server = http.createServer(async (req,res) => {
  try {
    if (req.method === 'GET' && req.url === classPath) {
      const id = randomBytes(16).toString('hex');
      const page = template.replace('<main id="welcome">', () =>
        '<main id="welcome" data-form="' + attr(form.href) + '" data-ticket="' + id + '.' + sign(classPath + id) + '">')
        .replace('src="monitor.js"', 'src="/monitor.js"');
      return respond(res,200,page,'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && req.url === '/monitor.js') return respond(res,200,script,'text/javascript');
    if (req.method === 'POST' && req.url === '/api/events') return await receive(req,res);
    return respond(res,404);
  } catch (error) {
    console.error('Request failed:', error.code || error.name);
    if (!res.headersSent) respond(res,500);
  }
});
server.on('error', e => fail(e.message));
server.listen(port,host,() => {
  const addresses = host === '0.0.0.0' ? Object.values(networkInterfaces()).flat()
    .filter(i => i.family === 'IPv4' && !i.internal).map(i => i.address) : [host];
  for (const address of addresses) console.log('Quiz:', 'http://' + (address.includes(':') ? '['+address+']' : address) + ':' + port + classPath);
  console.log('Teacher report (local terminal): node server.mjs --report');
});
