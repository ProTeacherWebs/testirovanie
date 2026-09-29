import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createClient } from '@libsql/client';
import { answerKey } from './answer-key.mjs';
import { questions } from './src/questions.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicRoot = join(root, 'dist');
const port = Number(process.env.PORT || 4173);
const databaseUrl = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
const adminPassword = process.env.ADMIN_PASSWORD || '';
const db = databaseUrl && authToken ? createClient({ url: databaseUrl, authToken }) : null;
const adminSessions = new Map();
const openQuestions = questions.filter((question) => question.type === 'text' || question.type === 'fields');
let schemaReady;

async function ensureSchema() {
  if (!db) throw new Error('Turso не настроен. Добавьте TURSO_DATABASE_URL и TURSO_AUTH_TOKEN в .env.');
  schemaReady ||= (async () => {
    await db.batch([
      `CREATE TABLE IF NOT EXISTS registrations (
        id TEXT PRIMARY KEY,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        study_time TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS attempts (
        id TEXT PRIMARY KEY,
        registration_id TEXT NOT NULL REFERENCES registrations(id),
        started_at TEXT NOT NULL,
        submitted_at TEXT,
        answers TEXT NOT NULL DEFAULT '{}',
        events TEXT NOT NULL DEFAULT '[]',
        auto_score INTEGER,
        auto_total INTEGER,
        tab_switches INTEGER NOT NULL DEFAULT 0
      )`
    ], 'write');
    const columns = await db.execute('PRAGMA table_info(attempts)');
    const existingColumns = new Set(columns.rows.map((column) => column.name));
    if (!existingColumns.has('manual_grades')) {
      await db.execute("ALTER TABLE attempts ADD COLUMN manual_grades TEXT NOT NULL DEFAULT '{}'");
    }
    if (!existingColumns.has('reviewed_at')) {
      await db.execute('ALTER TABLE attempts ADD COLUMN reviewed_at TEXT');
    }
  })();
  return schemaReady;
}

function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

async function readBody(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 120_000) throw new Error('Размер запроса превышает допустимый.');
  }
  return raw ? JSON.parse(raw) : {};
}

function getString(value, max = 80) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function countTabSwitches(events) {
  return Array.isArray(events) ? events.filter((event) => event?.type === 'page_hidden').length : 0;
}

function getAdminSession(request) {
  const cookies = String(request.headers.cookie || '').split(';');
  const sessionCookie = cookies.find((part) => part.trim().startsWith('admin_session='));
  const sessionId = sessionCookie?.split('=').slice(1).join('=').trim();
  if (!sessionId) return null;
  const expiresAt = adminSessions.get(sessionId);
  if (!expiresAt || expiresAt <= Date.now()) {
    adminSessions.delete(sessionId);
    return null;
  }
  return sessionId;
}

function secureCookie(request) {
  return request.socket.encrypted || request.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
}

function passwordMatches(password) {
  if (!adminPassword || typeof password !== 'string') return false;
  const provided = Buffer.from(password);
  const expected = Buffer.from(adminPassword);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function grade(answers) {
  let score = 0;
  const questions = [];
  for (const [questionId, correct] of Object.entries(answerKey)) {
    const submitted = answers?.[questionId];
    const selected = Array.isArray(submitted) ? [...submitted].sort() : typeof submitted === 'string' ? [submitted] : [];
    const isCorrect = JSON.stringify(selected) === JSON.stringify([...correct].sort());
    if (isCorrect) score++;
    questions.push({ questionId, correct: isCorrect, expectedOptions: [...correct] });
  }
  return { score, total: questions.length, questions };
}

async function apiRoute(request, response, url) {
  try {
    await ensureSchema();
    if (request.method === 'GET' && url.pathname === '/api/status') return json(response, 200, { ready: true });

    if (url.pathname === '/api/admin/login' && request.method === 'POST') {
      if (!adminPassword) return json(response, 503, { error: 'В .env не задан пароль админки (ADMIN_PASSWORD).' });
      const body = await readBody(request);
      if (!passwordMatches(body.password)) return json(response, 401, { error: 'Неверный пароль.' });
      const sessionId = randomUUID();
      adminSessions.set(sessionId, Date.now() + 8 * 60 * 60 * 1000);
      response.setHeader('Set-Cookie', `admin_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secureCookie(request)}`);
      return json(response, 200, { authenticated: true });
    }

    if (url.pathname === '/api/admin/session' && request.method === 'GET') {
      return json(response, 200, { authenticated: Boolean(getAdminSession(request)) });
    }

    if (url.pathname === '/api/admin/logout' && request.method === 'POST') {
      const sessionId = getAdminSession(request);
      if (sessionId) adminSessions.delete(sessionId);
      response.setHeader('Set-Cookie', `admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie(request)}`);
      return json(response, 200, { authenticated: false });
    }

    if (url.pathname.startsWith('/api/admin/')) {
      if (!getAdminSession(request)) return json(response, 401, { error: 'Войдите в админку.' });

      if (request.method === 'GET' && url.pathname === '/api/admin/students') {
        const result = await db.execute(`SELECT r.id AS registration_id, r.first_name, r.last_name, r.study_time, r.created_at,
          a.id AS attempt_id, a.started_at, a.submitted_at, a.auto_score, a.auto_total, a.manual_grades, a.reviewed_at
          FROM registrations r JOIN attempts a ON a.registration_id = r.id`);
        const students = result.rows.map((row) => {
          const manualGrades = JSON.parse(row.manual_grades || '{}');
          const reviewComplete = openQuestions.every((question) => typeof manualGrades[question.id] === 'boolean');
          const manualScore = openQuestions.filter((question) => manualGrades[question.id] === true).length;
          return {
            registrationId: row.registration_id,
            attemptId: row.attempt_id,
            firstName: row.first_name,
            lastName: row.last_name,
            studyTime: row.study_time,
            createdAt: row.created_at,
            startedAt: row.started_at,
            submittedAt: row.submitted_at,
            autoScore: row.auto_score,
            autoTotal: row.auto_total,
            manualScore,
            overallScore: reviewComplete ? (Number(row.auto_score) || 0) + manualScore : null,
            reviewedAt: row.reviewed_at,
            status: reviewComplete && row.reviewed_at ? 'reviewed' : row.submitted_at ? 'review' : 'in_progress'
          };
        }).sort((a, b) => a.studyTime.localeCompare(b.studyTime) || a.lastName.localeCompare(b.lastName, 'ru') || a.firstName.localeCompare(b.firstName, 'ru'));
        return json(response, 200, { students });
      }

      const reviewMatch = url.pathname.match(/^\/api\/admin\/attempts\/([\w-]+)\/review$/);
      if (reviewMatch && request.method === 'PUT') {
        const body = await readBody(request);
        const manualGrades = body.manualGrades;
        const valid = manualGrades && typeof manualGrades === 'object' && !Array.isArray(manualGrades)
          && Object.entries(manualGrades).every(([id, value]) => openQuestions.some((question) => question.id === id) && typeof value === 'boolean');
        if (!valid) return json(response, 400, { error: 'Проверка содержит некорректные отметки.' });
        const submitted = await db.execute({ sql: 'SELECT submitted_at FROM attempts WHERE id = ?', args: [reviewMatch[1]] });
        if (!submitted.rows.length) return json(response, 404, { error: 'Попытка не найдена.' });
        if (!submitted.rows[0].submitted_at) return json(response, 409, { error: 'Ученик ещё не отправил тест.' });
        const complete = openQuestions.every((question) => typeof manualGrades[question.id] === 'boolean');
        const reviewedAt = complete ? new Date().toISOString() : null;
        await db.execute({
          sql: 'UPDATE attempts SET manual_grades = ?, reviewed_at = ? WHERE id = ?',
          args: [JSON.stringify(manualGrades), reviewedAt, reviewMatch[1]]
        });
        return json(response, 200, { manualGrades, reviewedAt, complete });
      }

      const attemptMatch = url.pathname.match(/^\/api\/admin\/attempts\/([\w-]+)$/);
      if (attemptMatch && request.method === 'GET') {
        const result = await db.execute({
          sql: `SELECT r.first_name, r.last_name, r.study_time, a.id AS attempt_id, a.answers, a.submitted_at,
            a.auto_score, a.auto_total, a.tab_switches, a.manual_grades, a.reviewed_at
            FROM attempts a JOIN registrations r ON r.id = a.registration_id WHERE a.id = ?`,
          args: [attemptMatch[1]]
        });
        if (!result.rows.length) return json(response, 404, { error: 'Попытка не найдена.' });
        const row = result.rows[0];
        const answers = JSON.parse(row.answers || '{}');
        const automatic = grade(answers);
        return json(response, 200, {
          attemptId: row.attempt_id,
          firstName: row.first_name,
          lastName: row.last_name,
          studyTime: row.study_time,
          answers,
          submittedAt: row.submitted_at,
          autoScore: Number(row.auto_score) || 0,
          autoTotal: Number(row.auto_total) || automatic.total,
          tabSwitches: Number(row.tab_switches) || 0,
          gradedQuestions: automatic.questions,
          manualGrades: JSON.parse(row.manual_grades || '{}'),
          reviewedAt: row.reviewed_at
        });
      }
      return json(response, 404, { error: 'Маршрут админки не найден.' });
    }

    if (request.method === 'POST' && url.pathname === '/api/register') {
      const body = await readBody(request);
      const firstName = getString(body.firstName);
      const lastName = getString(body.lastName);
      const studyTime = getString(body.studyTime, 10);
      if (!firstName || !lastName || !['15:00', '17:00'].includes(studyTime)) return json(response, 400, { error: 'Укажите имя, фамилию и время обучения: 15:00 или 17:00.' });
      const registrationId = randomUUID();
      const attemptId = randomUUID();
      const now = new Date().toISOString();
      await db.batch([
        { sql: 'INSERT INTO registrations (id, first_name, last_name, study_time, created_at) VALUES (?, ?, ?, ?, ?)', args: [registrationId, firstName, lastName, studyTime, now] },
        { sql: 'INSERT INTO attempts (id, registration_id, started_at, answers, events) VALUES (?, ?, ?, ?, ?)', args: [attemptId, registrationId, now, '{}', '[]'] }
      ], 'write');
      return json(response, 201, { attemptId, startedAt: now });
    }

    const attemptMatch = url.pathname.match(/^\/api\/attempts\/([\w-]+)$/);
    if (attemptMatch && request.method === 'GET') {
      const result = await db.execute({ sql: 'SELECT answers, events, submitted_at FROM attempts WHERE id = ?', args: [attemptMatch[1]] });
      if (!result.rows.length) return json(response, 404, { error: 'Попытка не найдена.' });
      const row = result.rows[0];
      return json(response, 200, { answers: JSON.parse(row.answers), events: JSON.parse(row.events), submittedAt: row.submitted_at });
    }
    if (attemptMatch && request.method === 'PUT') {
      const body = await readBody(request);
      const answers = body.answers && typeof body.answers === 'object' ? body.answers : {};
      const events = Array.isArray(body.events) ? body.events.slice(-1000) : [];
      const result = await db.execute({
        sql: 'UPDATE attempts SET answers = ?, events = ?, tab_switches = ? WHERE id = ? AND submitted_at IS NULL',
        args: [JSON.stringify(answers), JSON.stringify(events), countTabSwitches(events), attemptMatch[1]]
      });
      if (!result.rowsAffected) return json(response, 404, { error: 'Активная попытка не найдена.' });
      return json(response, 200, { saved: true });
    }
    const submitMatch = url.pathname.match(/^\/api\/attempts\/([\w-]+)\/submit$/);
    if (submitMatch && request.method === 'POST') {
      const body = await readBody(request);
      const answers = body.answers && typeof body.answers === 'object' ? body.answers : {};
      const events = Array.isArray(body.events) ? body.events.slice(-1000) : [];
      const result = grade(answers);
      const submittedAt = new Date().toISOString();
      const update = await db.execute({
        sql: 'UPDATE attempts SET answers = ?, events = ?, tab_switches = ?, auto_score = ?, auto_total = ?, submitted_at = ? WHERE id = ? AND submitted_at IS NULL',
        args: [JSON.stringify(answers), JSON.stringify(events), countTabSwitches(events), result.score, result.total, submittedAt, submitMatch[1]]
      });
      if (!update.rowsAffected) return json(response, 409, { error: 'Попытка уже отправлена или не найдена.' });
      return json(response, 200, { autoScore: result.score, autoTotal: result.total, gradedQuestions: result.questions.map(({ questionId, correct }) => ({ questionId, correct })), tabSwitches: countTabSwitches(events) });
    }
    return json(response, 404, { error: 'Маршрут не найден.' });
  } catch (error) {
    const status = error.message.includes('Turso не настроен') ? 503 : error instanceof SyntaxError ? 400 : 500;
    if (status === 500) {
      const safeMessage = String(error.message || error)
        .replaceAll(authToken || '\u0000', '[token hidden]')
        .replace(/(?:libsql|https?):\/\/[^\s"']+/g, '[database URL hidden]');
      console.error(`[api] ${error.code || error.name || 'Error'}: ${safeMessage}`);
    }
    return json(response, status, { error: status === 500 ? 'Не удалось сохранить данные. Проверьте подключение к базе.' : error.message });
  }
}

const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) return apiRoute(request, response, url);
  if (!['GET', 'HEAD'].includes(request.method)) return json(response, 405, { error: 'Метод не поддерживается.' });
  let path;
  try { path = decodeURIComponent(url.pathname); } catch { return json(response, 400, { error: 'Некорректный путь.' }); }
  const filePath = path === '/' || path === '/admin' || path === '/admin/' ? '/index.html' : path;
  const file = resolve(publicRoot, `.${filePath}`);
  if (file !== publicRoot && !file.startsWith(`${publicRoot}${sep}`)) return json(response, 403, { error: 'Доступ запрещён.' });
  try {
    const info = await stat(file);
    if (!info.isFile()) return json(response, 404, { error: 'Файл не найден.' });
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    if (request.method === 'HEAD') return response.end();
    response.end(await readFile(file));
  } catch {
    json(response, 404, { error: 'Файл не найден.' });
  }
});

server.listen(port, () => console.log(`Frontend exam ready at http://localhost:${port}`));
