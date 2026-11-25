import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
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
  CREATE TABLE IF NOT EXISTS response_emails (attempt TEXT PRIMARY KEY, email TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS participants (attempt TEXT PRIMARY KEY, details TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS events (
    attempt TEXT NOT NULL, seq INTEGER NOT NULL, student TEXT NOT NULL,
    kind TEXT NOT NULL, observed TEXT NOT NULL, received TEXT NOT NULL,
    duration_ms INTEGER, PRIMARY KEY (attempt, seq));`);
chmodSync(file('data/monitor.sqlite'), 0o600);

if (process.argv.slice(2).join(' ') === '--clear-report') {
  try {
    db.exec(`BEGIN IMMEDIATE;
      DELETE FROM response_emails;
      DELETE FROM participants;
      DELETE FROM events;
      COMMIT;`);
  } finally {
    db.close();
  }
  console.log('Local report cleared.');
  process.exit(0);
}

if (process.argv.includes('--report')) {
  const rows = db.prepare(`SELECT e.*, p.details, r.email FROM events e
    LEFT JOIN participants p USING (attempt) LEFT JOIN response_emails r USING (attempt)
    ORDER BY student, attempt, seq`).all();
  console.table(rows.map(reportRow));
  db.close();
  process.exit(0);
}

function reportRow(row) {
  const profile = JSON.parse(row.details || '{}');
  const fields = new Map(Object.entries(profile).map(([key, value]) => [key.trim().toLowerCase(), value]));
  return {
    nome_completo: fields.get("full name") ?? null,
    email_dichiarata: fields.get("entered email") ?? null,
    email_google: row.email,
    nome: fields.get('first name') ?? fields.get('nome') ?? null,
    cognome: fields.get('last name') ?? fields.get('surname') ?? fields.get('cognome') ?? null,
    student_id: fields.get('student id') ?? fields.get('matricola') ?? (row.details || row.student === row.attempt ? null : row.student),
    attempt: row.attempt, seq: row.seq, kind: row.kind, observed: row.observed, duration_ms: row.duration_ms,
    ...((row.details && [...fields.keys()].some(k => !['entered email','full name','first name','nome','last name','surname','cognome','student id','matricola'].includes(k))) ? { other_details: row.details } : {})
  };
}

function fail(message) { console.error(message); process.exit(1); }
const form = URL.parse(process.env.FORM_URL || '');
if (form?.origin !== 'https://docs.google.com' || !/^\/forms\/d\/(?:e\/)?[\w-]+\/viewform\/?$/.test(form.pathname))
  fail('Set FORM_URL in .env to the full Google Forms respondent link ending in /viewform.');
// In the teacher's prefilled template each sample answer names its local input.
const identityFields = [...form.searchParams].filter(([key, value]) => /^entry\.\d+$/.test(key) && value !== 'MONITOR_ATTEMPT');
if (identityFields.length > 8 ||
    new Set(identityFields.map(([key]) => key)).size !== identityFields.length ||
    new Set(identityFields.map(([,label]) => label.trim())).size !== identityFields.length ||
    identityFields.some(([,label]) => !label.trim() || label.length > 50 || /[\x00-\x1f\x7f-\x9f]/u.test(label)))
  fail('Use distinct labels for up to eight short-answer identity fields in the prefilled URL.');
const host = process.env.HOST || '127.0.0.1';
const args = process.argv.slice(2);
const minutesIndex = args.indexOf('--minutes');
const minutesArg = minutesIndex === -1 ? '15' : args[minutesIndex + 1];
const minutes = Number(minutesArg);
if (!/^\d+$/.test(minutesArg || '') || minutes < 1 || !Number.isSafeInteger(minutes * 60000 + Date.now())) {
  fail('Use --minutes followed by a positive whole number, for example --minutes 30.');
}
const welcomeMessage = process.env.QUIZ_WELCOME_MESSAGE ??
  "Enter your details and select Start quiz.<br>In Google Forms, check your prefilled details and select Next to begin the exercises.<br>Your teacher receives your details and a record of fullscreen changes and time spent away from the quiz tab.";
const quizTitle = process.env.QUIZ_TITLE?.trim();
const port = Number(process.env.PORT || 8000);
if (!Number.isInteger(port) || port < 1 || port > 65535) fail('PORT must be between 1 and 65535.');
db.prepare("INSERT OR IGNORE INTO settings VALUES ('secret', ?)").run(randomBytes(32).toString('hex'));
const secret = db.prepare("SELECT value FROM settings WHERE key='secret'").get().value;
const sign = text => createHmac('sha256', secret).update(text).digest('hex');
const classPath = '/q/' + sign('class:' + form.href).slice(0,32);
function enabled(name) {
  const value = (process.env[name] ?? 'true').trim().toLowerCase();
  if (value !== 'true' && value !== 'false') fail(name + ' must be true or false.');
  return value === 'true';
}
let template = readFileSync(file('index.html'), 'utf8');
if (!enabled('SHOW_SESSION_LOG')) {
  template = template.replace('<h1>Session log</h1><ol id="log"></ol>', '<h1>Session finished</h1>');
}
if (!enabled('SHOW_RESTART_BUTTON')) {
  template = template.replace('<button id="again">Start another session</button>', '');
}
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
  if (event.fullName !== undefined) {
    if (event.seq !== 1 || event.type !== 'Session started' || event.student !== auth[1] ||
        typeof event.fullName !== 'string' || !event.fullName.trim() || event.fullName.length > 161 ||
        /[\x00-\x1f\x7f-\x9f]/u.test(event.fullName)) return respond(res,400);
    const details = {'Full name': event.fullName.trim()};
    if (event.firstName !== undefined || event.lastName !== undefined) {
      for (const [label, value] of [['First Name', event.firstName], ['Last Name', event.lastName]]) {
        if (typeof value !== 'string' || !value.trim() || value.length > 80 ||
            /[\x00-\x1f\x7f-\x9f]/u.test(value)) return respond(res,400);
        details[label] = value.trim();
      }
    }
    if (event.email !== undefined) {
      if (typeof event.email !== 'string' || event.email.length > 254 ||
          !/^[^\s@\x00-\x1f\x7f-\x9f]+@[^\s@\x00-\x1f\x7f-\x9f]+$/u.test(event.email)) return respond(res,400);
      details['Entered email'] = event.email;
    }
    if (event.studentId !== undefined) {
      if (typeof event.studentId !== 'string' || !event.studentId.trim() || event.studentId.length > 80 ||
          /[\x00-\x1f\x7f-\x9f]/u.test(event.studentId)) return respond(res,400);
      details['Student ID'] = event.studentId.trim();
    }
    db.prepare('INSERT OR IGNORE INTO participants VALUES (?,?)').run(auth[1], JSON.stringify(details));
  }
  if (identityFields.length && event.seq === 1 && event.student !== auth[1]) {
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
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(302, { Location: classPath, 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (req.method === 'GET' && req.url === classPath) {
      const id = randomBytes(16).toString('hex');
      const page = template.replace('<main id="welcome">', () =>
        '<main id="welcome" data-message="' + attr(welcomeMessage) + '" data-title="' + attr(quizTitle || '') + '" data-minutes="' + minutes + '" data-form="' + attr(form.href) + '" data-ticket="' + id + '.' + sign(classPath + id) + '">')
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
server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    const message = `Port ${port} is already in use. The quiz server could not start.`;
    console.error(process.stderr.isTTY ? '\x1b[31m' + message + '\x1b[0m' : message);
    if (process.platform !== 'win32') {
      const args = ['-nP', '-iTCP:' + port, '-sTCP:LISTEN'];
      const result = spawnSync('lsof', [...args, '-Fpc'], { encoding: 'utf8', timeout: 3000 });
      const listeners = (result.stdout || '').matchAll(/^p(\d+)\nc([^\r\n]+)/gm);
      let found = false;
      for (const [, pid, command] of listeners) {
        found = true;
        console.error(`Listener: ${command} (PID ${pid}). To stop this process: kill -TERM ${pid}`);
      }
      if (!found) console.error('Find the listener with: lsof ' + args.join(' ') + '\nThen run: kill -TERM <PID>');
    }
    fail('After freeing the port, run the same Node command again.');
  }
  fail(error.message);
});
server.listen(port,host,() => {
  const markers = new Set(identityFields.map(([, value]) => value));
  const missing = ['FIRST_NAME', 'LAST_NAME'].filter(marker => !markers.has(marker));
  if (missing.length) {
    console.warn('Name prefill incomplete. Missing in FORM_URL:', missing.join(', '));
    console.warn('In Google Forms choose Pre-fill form, enter FIRST_NAME and LAST_NAME in their answer boxes, then copy the generated link into .env and restart.');
  }
  console.log('Teacher report (local terminal): node server.mjs --report');
  const address = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '::1' : host;
  const origin = 'http://' + (address.includes(':') ? '[' + address + ']' : address) + ':' + port;
  console.log('Local quiz:', origin);
  if (host === '0.0.0.0') {
    try {
      for (const iface of Object.values(networkInterfaces()).flat()) {
        if (iface.family === 'IPv4' && !iface.internal) {
          console.log('LAN quiz:', 'http://' + iface.address + ':' + port);
        }
      }
    } catch (error) {
      console.warn('Could not list LAN addresses:', error.message);
    }
  }
  if (!process.argv.includes('--local')) startTunnel(origin);
});

function startTunnel(origin) {
  console.log('Starting Cloudflare Tunnel...');
  const tunnel = spawn('cloudflared', ['tunnel', '--url', origin], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stopping = false;
  let publicURL;
  let registered = false;
  let announced = false;
  function stop() {
    stopping = true;
    tunnel.kill('SIGTERM');
    server.close();
    server.closeAllConnections();
  }
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  for (const stream of [tunnel.stdout, tunnel.stderr]) {
    createInterface({ input: stream }).on('line', line => {
      const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i);
      if (match) publicURL = match[0];
      if (line.includes('Registered tunnel connection')) registered = true;
      if (publicURL && registered && !announced) {
        announced = true;
        console.log('Public quiz:', publicURL);
      }
      if (/\b(ERR|WRN)\b/.test(line)) console.error(line);
    });
  }
  tunnel.on('error', error => console.error('Cannot run cloudflared:', error.message,
    'Install cloudflared or use --local.'));
  tunnel.once('close', () => {
    if (!stopping) {
      console.error('Cloudflare Tunnel stopped. Restart the server to create a new public link.');
      process.exitCode = 1;
      server.close();
      server.closeAllConnections();
    }
  });
}
