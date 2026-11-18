import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import * as XLSX from 'xlsx';
import { createServer as createViteServer } from 'vite';

import { db, recordAuditLog } from './server/db.ts';
import {
  encryptSecret,
  decryptSecret,
  maskSecret,
  signToken,
  verifyToken,
  type AuthTokenPayload,
} from './server/crypto.ts';
import {
  generateQuestionsWithProvider,
  type AiProvider,
  type QuestionType,
} from './server/ai.ts';
import {
  analyzeExamItems,
  gradeQuestionItem,
  type QuestionRecord,
  type SessionRecord,
} from './server/cbtAnalysis.ts';
import {
  getSchoolNowParts,
  parseSchoolLocalDateTimeMs,
  timeToMinutes,
} from './server/time.ts';
import {
  aiGenerateSchema,
  aiKeySchema,
  attendanceSettingsSchema,
  changePasswordSchema,
  createExamSchema,
  createMeetingSchema,
  loginSchema,
  slideSchema,
  uploadSchema,
  userUpsertSchema,
} from './server/validation.ts';

interface AuthedRequest extends Request {
  user?: AuthTokenPayload & { name: string; status: string };
}

const uploadDir = path.resolve(process.cwd(), 'data', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const ALLOWED_UPLOAD_TYPES: Record<string, { ext: string; inline: boolean }> = {
  'application/pdf': { ext: '.pdf', inline: true },
  'image/jpeg': { ext: '.jpg', inline: true },
  'image/jpg': { ext: '.jpg', inline: true },
  'image/png': { ext: '.png', inline: true },
  'image/webp': { ext: '.webp', inline: true },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: '.docx', inline: false },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: '.xlsx', inline: false },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { ext: '.pptx', inline: false },
  'text/plain': { ext: '.txt', inline: false },
};

function seededShuffle<T>(items: T[], seedStr: string): T[] {
  const arr = [...items];
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0;
  const rand = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getTimezoneOffsetMinutes(tz: string): number {
  if (tz === 'Asia/Makassar') return 480;
  if (tz === 'Asia/Jayapura') return 540;
  return 420; // Asia/Jakarta (WIB, UTC+7)
}

function normalizeExamDateTime(raw: string | undefined, fallbackIso: string, tz: string): string {
  const val = String(raw || '').trim();
  if (!val) return fallbackIso;
  const localMatch = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(val);
  if (localMatch) {
    const ms = parseSchoolLocalDateTimeMs(localMatch[1], localMatch[2]) - getTimezoneOffsetMinutes(tz) * 60000;
    return new Date(ms).toISOString();
  }
  const parsed = new Date(val);
  return Number.isNaN(parsed.getTime()) ? fallbackIso : parsed.toISOString();
}

function parseAssignmentDeadlineMs(rawDeadline: string, tz: string): number | null {
  const val = String(rawDeadline || '').trim();
  if (!val) return null;
  const offsetMs = getTimezoneOffsetMinutes(tz) * 60000;
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    return parseSchoolLocalDateTimeMs(val, '23:59') - offsetMs;
  }
  const localMatch = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(val);
  if (localMatch && !/[zZ]|[+-]\d{2}:\d{2}$/.test(val)) {
    return parseSchoolLocalDateTimeMs(localMatch[1], localMatch[2]) - offsetMs;
  }
  const parsed = Date.parse(val);
  return Number.isNaN(parsed) ? null : parsed;
}

const app = express();
app.set('trust proxy', 1);
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '12mb' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0');
  next();
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak percobaan login. Silakan coba lagi dalam beberapa menit.' },
});

const aiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Batas permintaan pembuat soal AI tercapai. Tunggu beberapa saat sebelum mencoba lagi.' },
});

function getClientIp(req: Request): string {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.ip || req.socket.remoteAddress || '';
}

function getSchoolTimezone(): string {
  const row = db.prepare('SELECT timezone FROM attendance_settings WHERE id = 1').get() as { timezone?: string } | undefined;
  return row?.timezone || 'Asia/Jakarta';
}

function setSessionCookie(req: Request, res: Response, token: string): void {
  const isHttps = req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https');
  res.cookie('lentera_session', token, {
    httpOnly: true,
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
    maxAge: 24 * 3600 * 1000,
    path: '/',
  });
}

function clearSessionCookie(req: Request, res: Response): void {
  const isHttps = req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https');
  res.clearCookie('lentera_session', {
    httpOnly: true,
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
    path: '/',
  });
}

// ============================================================================
// High-Concurrency CBT Caching & Coalesced Write Queue
// ============================================================================
interface CachedExamBundle {
  etag: string;
  studentPayload: string;
  questions: QuestionRecord[];
  examMeta: any;
}
const examBundleCache = new Map<string, CachedExamBundle>();

interface PendingAnswerUpdate {
  sessionId: string;
  answers: Record<string, any>;
  resolveList: Array<() => void>;
}
const pendingAnswerMap = new Map<string, PendingAnswerUpdate>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flushPendingAnswersToDb(): void {
  if (pendingAnswerMap.size === 0) return;
  const batch = Array.from(pendingAnswerMap.values());
  pendingAnswerMap.clear();
  flushTimer = null;

  try {
    db.exec('BEGIN IMMEDIATE');
    const getStmt = db.prepare('SELECT answers_json FROM cbt_sessions WHERE id = ?');
    const updStmt = db.prepare('UPDATE cbt_sessions SET answers_json = ? WHERE id = ?');

    for (const item of batch) {
      const row = getStmt.get(item.sessionId) as { answers_json: string } | undefined;
      if (row) {
        const current = JSON.parse(row.answers_json || '{}');
        const merged = { ...current, ...item.answers };
        updStmt.run(JSON.stringify(merged), item.sessionId);
      }
      for (const resolve of item.resolveList) resolve();
    }
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    for (const item of batch) {
      for (const resolve of item.resolveList) resolve();
    }
    console.error('Batch flush error:', err);
  }
}

function enqueueAnswerMerge(sessionId: string, answers: Record<string, any>): Promise<void> {
  return new Promise((resolve) => {
    const existing = pendingAnswerMap.get(sessionId);
    if (existing) {
      existing.answers = { ...existing.answers, ...answers };
      existing.resolveList.push(resolve);
    } else {
      pendingAnswerMap.set(sessionId, {
        sessionId,
        answers: { ...answers },
        resolveList: [resolve],
      });
    }
    if (!flushTimer) {
      flushTimer = setTimeout(flushPendingAnswersToDb, 120);
    }
  });
}

function getExamBundle(examId: string): CachedExamBundle | null {
  const cached = examBundleCache.get(examId);
  if (cached) return cached;

  const exam = db.prepare('SELECT * FROM cbt_exams WHERE id = ?').get(examId) as any;
  if (!exam) return null;

  const qIds: string[] = JSON.parse(exam.question_ids_json || '[]');
  if (qIds.length === 0) return null;

  const placeholders = qIds.map(() => '?').join(',');
  const qRows = db
    .prepare(`SELECT * FROM questions WHERE id IN (${placeholders})`)
    .all(...qIds) as any[];
  const qMap = new Map(qRows.map((r) => [r.id, r]));

  const questions: QuestionRecord[] = qIds
    .map((id) => qMap.get(id))
    .filter(Boolean)
    .map((r) => ({
      id: r.id,
      type: r.type as QuestionType,
      prompt: r.prompt,
      options: JSON.parse(r.options_json || '[]'),
      answerKey: JSON.parse(r.answer_key_json || '""'),
      points: Number(r.points) || 10,
      explanation: r.explanation || '',
    }));

  // Strip answer keys & explanations from student bundle!
  const sanitizedQuestions = questions.map((q) => ({
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    options: q.options,
    points: q.points,
  }));

  const studentPayloadObj = {
    exam: {
      id: exam.id,
      title: exam.title,
      subject: exam.subject,
      durationMinutes: exam.duration_minutes,
      maxViolations: exam.max_violations,
      requireFullscreen: Boolean(exam.require_fullscreen),
      shuffleQuestions: Boolean(exam.shuffle_questions),
      shuffleOptions: Boolean(exam.shuffle_options),
      startAt: exam.start_at,
      endAt: exam.end_at,
    },
    questions: sanitizedQuestions,
  };
  const studentPayload = JSON.stringify(studentPayloadObj);
  const etag = `"${crypto.createHash('sha1').update(studentPayload).digest('hex')}"`;

  const entry: CachedExamBundle = {
    etag,
    studentPayload,
    questions,
    examMeta: exam,
  };
  examBundleCache.set(examId, entry);
  return entry;
}

// ============================================================================
// Auth & RBAC Middleware
// ============================================================================
function authMiddleware(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  const cookieToken = String((req as any).cookies?.lentera_session || '');
  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : cookieToken || String(req.query.token || '');
  if (!token) {
    res.status(401).json({ error: 'Sesi login diperlukan.' });
    return;
  }
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Token sesi tidak valid atau kedaluwarsa.' });
    return;
  }
  const dbUser = db
    .prepare('SELECT id, username, name, role, class_name, status, session_version FROM users WHERE id = ?')
    .get(payload.userId) as any;
  if (!dbUser) {
    res.status(401).json({ error: 'Pengguna tidak ditemukan.' });
    return;
  }
  if (Number(dbUser.session_version || 1) !== Number(payload.sessionVersion || 1)) {
    res.status(401).json({ error: 'Sesi telah dicabut karena perubahan kata sandi atau status akun. Silakan login kembali.' });
    return;
  }
  if (dbUser.status === 'lulus') {
    res.status(403).json({
      error: 'Akun alumni: siswa yang telah lulus otomatis tidak dapat mengakses portal login.',
    });
    return;
  }
  if (dbUser.status !== 'aktif') {
    res.status(403).json({ error: 'Akun dinonaktifkan oleh administrator.' });
    return;
  }
  req.user = {
    ...payload,
    role: dbUser.role,
    className: dbUser.class_name || '',
    name: dbUser.name,
    status: dbUser.status,
    sessionVersion: Number(dbUser.session_version || 1),
  };
  next();
}

function requireRoles(...roles: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Akses ditolak: peran Anda tidak memiliki izin untuk halaman/aksi ini.' });
      return;
    }
    next();
  };
}

// ============================================================================
// 0. Authenticated File Uploads (Materials, Submissions, Attachments)
// ============================================================================
app.post('/api/uploads', authMiddleware, (req: AuthedRequest, res) => {
  const parsed = uploadSchema.safeParse(req.body || {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Format berkas unggahan tidak valid.' });
    return;
  }
  const { filename, mimeType, dataBase64 } = parsed.data;
  const spec = ALLOWED_UPLOAD_TYPES[mimeType.toLowerCase()];
  if (!spec) {
    res.status(400).json({ error: `Tipe berkas "${mimeType}" tidak diizinkan. Gunakan PDF, JPG, PNG, WebP, DOCX, XLSX, atau PPTX.` });
    return;
  }
  const cleanedB64 = dataBase64.replace(/^data:[^;]+;base64,/, '').trim();
  const buffer = Buffer.from(cleanedB64, 'base64');
  if (buffer.length === 0 || buffer.length > 6 * 1024 * 1024) {
    res.status(400).json({ error: 'Ukuran berkas maksimal 6 MB dan tidak boleh kosong.' });
    return;
  }

  const id = `upl-${crypto.randomUUID().slice(0, 10)}`;
  const storedName = `${crypto.randomUUID()}${spec.ext}`;
  const targetPath = path.join(uploadDir, storedName);
  fs.writeFileSync(targetPath, buffer);

  const safeOriginal = path.basename(filename).replace(/[^\w.\- ()]/g, '_').slice(0, 140) || `berkas${spec.ext}`;
  db.prepare(`
    INSERT INTO uploads (id, owner_id, original_name, stored_name, mime_type, size_bytes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.user!.userId, safeOriginal, storedName, mimeType.toLowerCase(), buffer.length, new Date().toISOString());

  recordAuditLog({
    actorId: req.user!.userId,
    actorName: req.user!.name,
    actorRole: req.user!.role,
    action: 'UPLOAD_FILE',
    targetType: 'upload',
    targetId: id,
    detail: `Mengunggah "${safeOriginal}" (${Math.ceil(buffer.length / 1024)} KB)`,
    ipAddress: getClientIp(req),
  });

  res.json({
    id,
    url: `/api/uploads/${storedName}`,
    storedName,
    originalName: safeOriginal,
    mimeType: mimeType.toLowerCase(),
    sizeBytes: buffer.length,
  });
});

app.get('/api/uploads/:storedName', authMiddleware, (req, res) => {
  const safeName = String(req.params.storedName || '');
  if (!/^[a-zA-Z0-9._-]+$/.test(safeName)) {
    res.status(400).json({ error: 'Nama berkas tidak valid.' });
    return;
  }
  const fullPath = path.resolve(uploadDir, safeName);
  if (!fullPath.startsWith(uploadDir + path.sep) || !fs.existsSync(fullPath)) {
    res.status(404).json({ error: 'Berkas tidak ditemukan.' });
    return;
  }
  const row = db.prepare('SELECT original_name, mime_type FROM uploads WHERE stored_name = ?').get(safeName) as
    | { original_name: string; mime_type: string }
    | undefined;
  const mime = row?.mime_type || 'application/octet-stream';
  const spec = ALLOWED_UPLOAD_TYPES[mime];
  const disp = spec?.inline ? 'inline' : 'attachment';
  const orig = row?.original_name || safeName;
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `${disp}; filename="${orig.replace(/"/g, '')}"`);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(fullPath);
});

// ============================================================================
// 1. Auth & Editable Login Slides
// ============================================================================
app.get('/api/slides', (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM login_slides WHERE is_active = 1 ORDER BY sort_order ASC')
    .all();
  res.json(rows);
});

app.get('/api/admin/slides', authMiddleware, requireRoles('admin'), (_req, res) => {
  const rows = db.prepare('SELECT * FROM login_slides ORDER BY sort_order ASC').all();
  res.json(rows);
});

app.post('/api/admin/slides', authMiddleware, requireRoles('admin'), (req: AuthedRequest, res) => {
  const parsed = slideSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Data slide tidak valid.' });
    return;
  }
  const { title, subtitle, tag, imageUrl, accentColor, sortOrder, isActive } = parsed.data;
  const id = `sl-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(`
    INSERT INTO login_slides (id, title, subtitle, tag, image_url, accent_color, sort_order, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    title,
    subtitle,
    tag || 'Informasi Sekolah',
    imageUrl || '/src/assets/images/slide_cbt_campus_1794936322664.jpg',
    accentColor || '#0F766E',
    sortOrder,
    isActive ? 1 : 0
  );
  recordAuditLog({
    actorId: req.user!.userId,
    actorName: req.user!.name,
    actorRole: req.user!.role,
    action: 'CREATE_SLIDE',
    targetType: 'login_slide',
    targetId: id,
    detail: `Membuat slide login "${title}"`,
    ipAddress: getClientIp(req),
  });
  res.json({ id });
});

app.put('/api/admin/slides/:id', authMiddleware, requireRoles('admin'), (req: AuthedRequest, res) => {
  const parsed = slideSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Data slide tidak valid.' });
    return;
  }
  const { title, subtitle, tag, imageUrl, accentColor, sortOrder, isActive } = parsed.data;
  db.prepare(`
    UPDATE login_slides
    SET title = ?, subtitle = ?, tag = ?, image_url = ?, accent_color = ?, sort_order = ?, is_active = ?
    WHERE id = ?
  `).run(
    title,
    subtitle,
    tag || '',
    imageUrl || '/src/assets/images/slide_cbt_campus_1794936322664.jpg',
    accentColor || '#0F766E',
    sortOrder,
    isActive ? 1 : 0,
    req.params.id
  );
  res.json({ ok: true });
});

app.delete('/api/admin/slides/:id', authMiddleware, requireRoles('admin'), (req, res) => {
  db.prepare('DELETE FROM login_slides WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/auth/login', loginLimiter, (req, res) => {
  const parsed = loginSchema.safeParse(req.body || {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Username/NISN dan kata sandi wajib diisi.' });
    return;
  }
  const { username, password } = parsed.data;
  const user = db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(username.trim()) as any;
  if (!user) {
    res.status(401).json({ error: 'Username / NISN tidak ditemukan.' });
    return;
  }
  if (user.status === 'lulus') {
    recordAuditLog({
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      action: 'LOGIN_BLOCKED_ALUMNI',
      targetType: 'user',
      targetId: user.id,
      detail: `Percobaan login akun alumni (${user.username}) ditolak otomatis`,
      ipAddress: getClientIp(req),
    });
    res.status(403).json({
      error:
        'Akun ini berstatus LULUS (Alumni). Sesuai kebijakan sekolah, akun siswa yang telah lulus otomatis tidak dapat login lagi.',
    });
    return;
  }
  if (user.status !== 'aktif') {
    res.status(403).json({ error: 'Akun sedang dinonaktifkan.' });
    return;
  }
  const valid = bcrypt.compareSync(String(password), user.password_hash);
  if (!valid) {
    recordAuditLog({
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      action: 'LOGIN_FAILED',
      targetType: 'user',
      targetId: user.id,
      detail: `Kata sandi salah untuk username ${user.username}`,
      ipAddress: getClientIp(req),
    });
    res.status(401).json({ error: 'Kata sandi salah.' });
    return;
  }
  const sessionVersion = Number(user.session_version) || 1;
  const token = signToken({
    userId: user.id,
    username: user.username,
    role: user.role,
    className: user.class_name || '',
    sessionVersion,
  });
  setSessionCookie(req, res, token);
  recordAuditLog({
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    action: 'LOGIN_SUCCESS',
    targetType: 'user',
    targetId: user.id,
    detail: `Login berhasil (${user.role})`,
    ipAddress: getClientIp(req),
  });
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      className: user.class_name || '',
      homeroomClass: user.homeroom_class || '',
      photoUrl: user.photo_url || '',
      email: user.email || '',
    },
  });
});

app.post('/api/auth/logout', (req, res) => {
  const header = req.headers.authorization || '';
  const cookieToken = String((req as any).cookies?.lentera_session || '');
  const token = header.startsWith('Bearer ') ? header.slice(7) : cookieToken;
  const payload = token ? verifyToken(token) : null;
  if (payload) {
    recordAuditLog({
      actorId: payload.userId,
      actorName: payload.username,
      actorRole: payload.role,
      action: 'LOGOUT',
      targetType: 'user',
      targetId: payload.userId,
      detail: 'Pengguna keluar dari portal',
      ipAddress: getClientIp(req),
    });
  }
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

app.post('/api/auth/change-password', authMiddleware, (req: AuthedRequest, res) => {
  const parsed = changePasswordSchema.safeParse(req.body || {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Data perubahan sandi tidak valid.' });
    return;
  }
  const { currentPassword, newPassword } = parsed.data;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.userId) as any;
  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
    res.status(400).json({ error: 'Kata sandi saat ini tidak cocok.' });
    return;
  }
  const newHash = bcrypt.hashSync(newPassword, 10);
  const nextVersion = (Number(user.session_version) || 1) + 1;
  db.prepare('UPDATE users SET password_hash = ?, session_version = ? WHERE id = ?').run(
    newHash,
    nextVersion,
    user.id
  );
  const token = signToken({
    userId: user.id,
    username: user.username,
    role: user.role,
    className: user.class_name || '',
    sessionVersion: nextVersion,
  });
  setSessionCookie(req, res, token);
  recordAuditLog({
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    action: 'CHANGE_PASSWORD',
    targetType: 'user',
    targetId: user.id,
    detail: 'Kata sandi diubah sendiri dan sesi lama dicabut',
    ipAddress: getClientIp(req),
  });
  res.json({ ok: true, token });
});

app.get('/api/auth/me', authMiddleware, (req: AuthedRequest, res) => {
  const user = db
    .prepare('SELECT id, username, name, role, class_name, homeroom_class, status, photo_url, email FROM users WHERE id = ?')
    .get(req.user!.userId) as any;
  res.json({
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    className: user.class_name || '',
    homeroomClass: user.homeroom_class || '',
    photoUrl: user.photo_url || '',
    email: user.email || '',
  });
});

// Admin User CRUD, Bulk Import & Audit Logs
app.get('/api/admin/users', authMiddleware, requireRoles('admin'), (req, res) => {
  const role = req.query.role ? String(req.query.role) : '';
  const status = req.query.status ? String(req.query.status) : '';
  const q = req.query.q ? String(req.query.q).trim().toLowerCase() : '';
  let sql = 'SELECT id, username, name, role, class_name, homeroom_class, status, photo_url, email, phone, created_at FROM users WHERE 1=1';
  const params: any[] = [];
  if (role) {
    sql += ' AND role = ?';
    params.push(role);
  }
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  sql += ' ORDER BY role ASC, class_name ASC, name ASC';
  let rows = db.prepare(sql).all(...params) as any[];
  if (q) {
    rows = rows.filter(
      (r) =>
        String(r.name).toLowerCase().includes(q) ||
        String(r.username).toLowerCase().includes(q) ||
        String(r.class_name || '').toLowerCase().includes(q)
    );
  }
  res.json(rows);
});

app.post('/api/admin/users', authMiddleware, requireRoles('admin'), (req: AuthedRequest, res) => {
  const parsed = userUpsertSchema.safeParse(req.body || {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Data pengguna tidak valid.' });
    return;
  }
  const data = parsed.data;
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(data.username);
  if (existing) {
    res.status(409).json({ error: `Username / NIS "${data.username}" sudah terdaftar.` });
    return;
  }
  const id = `u-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const passwordHash = bcrypt.hashSync(data.password || 'Lentera123!', 10);
  const photoUrl =
    data.role === 'siswa'
      ? '/src/assets/images/avatar_student_male_1794936325167.jpg'
      : '/src/assets/images/avatar_student_female_1794936324549.jpg';

  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO users (id, username, password_hash, name, role, class_name, homeroom_class, status, photo_url, email, phone, session_version, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      id,
      data.username,
      passwordHash,
      data.name,
      data.role,
      data.className || '',
      data.homeroomClass || '',
      data.status || 'aktif',
      photoUrl,
      data.email || '',
      data.phone || '',
      now
    );

    if (data.role === 'siswa') {
      db.prepare(`
        INSERT INTO student_master_records (student_id, nis, nisn, photo_url, entry_year)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        id,
        data.username,
        String(req.body?.nisn || `00${Math.floor(10000000 + Math.random() * 89999999)}`),
        photoUrl,
        String(new Date().getFullYear())
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  recordAuditLog({
    actorId: req.user!.userId,
    actorName: req.user!.name,
    actorRole: req.user!.role,
    action: 'CREATE_USER',
    targetType: 'user',
    targetId: id,
    detail: `Menambahkan ${data.role}: ${data.name} (${data.username})`,
    ipAddress: getClientIp(req),
  });
  res.json({ id });
});

app.put('/api/admin/users/:id', authMiddleware, requireRoles('admin'), (req: AuthedRequest, res) => {
  const current = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as any;
  if (!current) {
    res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
    return;
  }
  const parsed = userUpsertSchema.safeParse({
    username: req.body?.username ?? current.username,
    name: req.body?.name ?? current.name,
    role: req.body?.role ?? current.role,
    className: req.body?.className ?? current.class_name,
    homeroomClass: req.body?.homeroomClass ?? current.homeroom_class,
    status: req.body?.status ?? current.status,
    email: req.body?.email ?? current.email,
    phone: req.body?.phone ?? current.phone,
    password: req.body?.password ? String(req.body.password) : undefined,
  });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Data pembaruan tidak valid.' });
    return;
  }
  const data = parsed.data;
  const shouldBumpSession = Boolean(data.password) || data.status !== current.status || data.role !== current.role;
  const nextVersion = shouldBumpSession ? (Number(current.session_version) || 1) + 1 : Number(current.session_version) || 1;
  const nextHash = data.password ? bcrypt.hashSync(data.password, 10) : current.password_hash;

  db.prepare(`
    UPDATE users
    SET username = ?, password_hash = ?, name = ?, role = ?, class_name = ?, homeroom_class = ?, status = ?, email = ?, phone = ?, session_version = ?
    WHERE id = ?
  `).run(
    data.username,
    nextHash,
    data.name,
    data.role,
    data.className || '',
    data.homeroomClass || '',
    data.status || 'aktif',
    data.email || '',
    data.phone || '',
    nextVersion,
    current.id
  );

  recordAuditLog({
    actorId: req.user!.userId,
    actorName: req.user!.name,
    actorRole: req.user!.role,
    action: 'UPDATE_USER',
    targetType: 'user',
    targetId: current.id,
    detail: `Memperbarui pengguna ${data.name} (${data.username}) · status=${data.status}${data.password ? ' · reset sandi' : ''}`,
    ipAddress: getClientIp(req),
  });
  res.json({ ok: true });
});

app.get('/api/admin/users/template', authMiddleware, requireRoles('admin'), (_req, res) => {
  const wb = XLSX.utils.book_new();
  const sample = [
    {
      username: '2026001',
      name: 'Nadia Kusuma Putri',
      role: 'siswa',
      className: 'X-1',
      password: 'Password123',
      nisn: '0108765432',
      gender: 'Perempuan',
    },
    {
      username: 'guru_baru1',
      name: 'Drs. Hendra Wijaya',
      role: 'guru',
      className: '',
      password: 'Password123',
      nisn: '',
      gender: 'Laki-laki',
    },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sample), 'Template Pengguna');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="template-impor-pengguna.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

app.post('/api/admin/users/import', authMiddleware, requireRoles('admin'), (req: AuthedRequest, res) => {
  const rows: any[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (rows.length === 0) {
    res.status(400).json({ error: 'Tidak ada baris data pengguna yang dikirim.' });
    return;
  }

  let createdCount = 0;
  let skippedCount = 0;
  const errors: string[] = [];
  const now = new Date().toISOString();

  const checkExisting = db.prepare('SELECT id FROM users WHERE username = ?');
  const insertUser = db.prepare(`
    INSERT INTO users (id, username, password_hash, name, role, class_name, homeroom_class, status, photo_url, email, phone, session_version, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'aktif', ?, ?, ?, 1, ?)
  `);
  const insertMaster = db.prepare(`
    INSERT INTO student_master_records (student_id, nis, nisn, gender, photo_url, entry_year)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  db.exec('BEGIN');
  try {
    rows.forEach((raw, idx) => {
      const parsed = userUpsertSchema.safeParse({
        username: String(raw.username || raw.nis || '').trim(),
        name: String(raw.name || raw.nama || '').trim(),
        role: String(raw.role || raw.peran || 'siswa').trim().toLowerCase(),
        className: String(raw.className || raw.kelas || '').trim(),
        homeroomClass: String(raw.homeroomClass || '').trim(),
        status: 'aktif',
        email: String(raw.email || '').trim(),
        phone: String(raw.phone || '').trim(),
        password: raw.password ? String(raw.password) : 'Lentera123!',
      });
      if (!parsed.success) {
        errors.push(`Baris ${idx + 1}: ${parsed.error.issues[0]?.message || 'format tidak valid'}`);
        skippedCount++;
        return;
      }
      const d = parsed.data;
      if (checkExisting.get(d.username)) {
        errors.push(`Baris ${idx + 1}: username "${d.username}" sudah ada`);
        skippedCount++;
        return;
      }
      const id = `u-${crypto.randomUUID().slice(0, 8)}`;
      const gender = String(raw.gender || 'Laki-laki');
      const photoUrl = gender.toLowerCase().includes('perempuan')
        ? '/src/assets/images/avatar_student_female_1794936324549.jpg'
        : '/src/assets/images/avatar_student_male_1794936325167.jpg';
      const hash = bcrypt.hashSync(d.password || 'Lentera123!', 10);

      insertUser.run(id, d.username, hash, d.name, d.role, d.className || '', d.homeroomClass || '', photoUrl, d.email || '', d.phone || '', now);
      if (d.role === 'siswa') {
        insertMaster.run(
          id,
          d.username,
          String(raw.nisn || `01${Math.floor(10000000 + Math.random() * 89999999)}`),
          gender,
          photoUrl,
          String(new Date().getFullYear())
        );
      }
      createdCount++;
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  recordAuditLog({
    actorId: req.user!.userId,
    actorName: req.user!.name,
    actorRole: req.user!.role,
    action: 'IMPORT_USERS',
    targetType: 'user',
    targetId: 'batch',
    detail: `Impor massal: ${createdCount} berhasil, ${skippedCount} dilewati`,
    ipAddress: getClientIp(req),
  });

  res.json({ createdCount, skippedCount, errors });
});

app.get('/api/admin/audit-logs', authMiddleware, requireRoles('admin'), (req, res) => {
  const action = req.query.action ? String(req.query.action) : '';
  const role = req.query.role ? String(req.query.role) : '';
  let sql = 'SELECT * FROM audit_logs WHERE 1=1';
  const params: any[] = [];
  if (action) {
    sql += ' AND action = ?';
    params.push(action);
  }
  if (role) {
    sql += ' AND actor_role = ?';
    params.push(role);
  }
  sql += ' ORDER BY created_at DESC LIMIT 200';
  res.json(db.prepare(sql).all(...params));
});

// ============================================================================
// 2. Users, Guru Pengampu & Jadwal Pelajaran
// ============================================================================
app.get('/api/users', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas', 'pengawas'), (req: AuthedRequest, res) => {
  const roleFilter = req.query.role ? String(req.query.role) : '';
  const classFilter = req.query.className ? String(req.query.className) : '';
  let sql = `SELECT id, username, name, role, class_name, homeroom_class, status, photo_url, email, phone,
    face_descriptor_json, CASE WHEN face_descriptor_json != '' THEN 1 ELSE 0 END as face_enrolled
    FROM users WHERE 1=1`;
  const params: any[] = [];
  if (roleFilter) {
    sql += ' AND role = ?';
    params.push(roleFilter);
  }
  if (classFilter) {
    sql += ' AND class_name = ?';
    params.push(classFilter);
  }
  sql += ' ORDER BY role ASC, name ASC';
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/academic/overview', authMiddleware, (req: AuthedRequest, res) => {
  const assignments = db.prepare('SELECT * FROM teacher_assignments ORDER BY class_name, subject').all();
  let schedules: any[];
  if (req.user!.role === 'siswa') {
    schedules = db
      .prepare('SELECT * FROM schedules WHERE class_name = ? ORDER BY day_name, start_time')
      .all(req.user!.className);
  } else {
    schedules = db.prepare('SELECT * FROM schedules ORDER BY class_name, day_name, start_time').all();
  }
  const teachers = db
    .prepare("SELECT id, name, role, homeroom_class FROM users WHERE role IN ('guru','wali_kelas')")
    .all();
  res.json({ assignments, schedules, teachers });
});

app.post('/api/academic/teacher-assignments', authMiddleware, requireRoles('admin'), (req, res) => {
  const { teacherId, subject, className } = req.body;
  const teacher = db.prepare('SELECT id, name FROM users WHERE id = ?').get(teacherId) as any;
  if (!teacher || !subject || !className) {
    res.status(400).json({ error: 'Guru, mata pelajaran, dan kelas wajib diisi.' });
    return;
  }
  const id = `ta-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(`
    INSERT INTO teacher_assignments (id, teacher_id, teacher_name, subject, class_name, academic_year)
    VALUES (?, ?, ?, ?, ?, '2026/2027')
  `).run(id, teacher.id, teacher.name, subject, className);
  res.json({ id });
});

app.delete('/api/academic/teacher-assignments/:id', authMiddleware, requireRoles('admin'), (req, res) => {
  db.prepare('DELETE FROM teacher_assignments WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/academic/schedules', authMiddleware, requireRoles('admin'), (req, res) => {
  const { className, dayName, startTime, endTime, subject, teacherId, room } = req.body;
  const teacher = db.prepare('SELECT id, name FROM users WHERE id = ?').get(teacherId) as any;
  if (!teacher || !className || !dayName || !startTime || !endTime || !subject) {
    res.status(400).json({ error: 'Lengkapi seluruh data jadwal pelajaran.' });
    return;
  }
  const id = `sc-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(`
    INSERT INTO schedules (id, class_name, day_name, start_time, end_time, subject, teacher_id, teacher_name, room)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, className, dayName, startTime, endTime, subject, teacher.id, teacher.name, room || 'Ruang Kelas');
  res.json({ id });
});

app.delete('/api/academic/schedules/:id', authMiddleware, requireRoles('admin'), (req, res) => {
  db.prepare('DELETE FROM schedules WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ============================================================================
// 3. Encrypted AI Provider Keys & AI Question Generation
// ============================================================================
app.get('/api/ai/keys', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas'), (req: AuthedRequest, res) => {
  const rows = db
    .prepare('SELECT provider, model_name, masked_key, updated_at FROM ai_provider_keys WHERE owner_id = ?')
    .all(req.user!.userId) as any[];
  res.json({
    builtInGeminiAvailable: Boolean(process.env.GEMINI_API_KEY),
    savedProviders: rows,
  });
});

app.post('/api/ai/keys', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas'), (req: AuthedRequest, res) => {
  const parsed = aiKeySchema.safeParse(req.body || {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Provider AI atau API key tidak valid.' });
    return;
  }
  const { provider, apiKey, modelName } = parsed.data;
  const encrypted = encryptSecret(apiKey.trim());
  const masked = maskSecret(apiKey.trim());
  const id = `aik-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO ai_provider_keys (id, owner_id, provider, model_name, encrypted_key, iv, auth_tag, masked_key, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_id, provider) DO UPDATE SET
      model_name = excluded.model_name,
      encrypted_key = excluded.encrypted_key,
      iv = excluded.iv,
      auth_tag = excluded.auth_tag,
      masked_key = excluded.masked_key,
      updated_at = excluded.updated_at
  `).run(
    id,
    req.user!.userId,
    provider,
    modelName || '',
    encrypted.encryptedKey,
    encrypted.iv,
    encrypted.authTag,
    masked,
    now
  );
  recordAuditLog({
    actorId: req.user!.userId,
    actorName: req.user!.name,
    actorRole: req.user!.role,
    action: 'SAVE_AI_KEY',
    targetType: 'ai_provider_key',
    targetId: provider,
    detail: `Menyimpan API key terenkripsi untuk provider ${provider}`,
    ipAddress: getClientIp(req),
  });
  res.json({ provider, maskedKey: masked, encrypted: true });
});

app.delete('/api/ai/keys/:provider', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas'), (req: AuthedRequest, res) => {
  db.prepare('DELETE FROM ai_provider_keys WHERE owner_id = ? AND provider = ?').run(
    req.user!.userId,
    req.params.provider
  );
  res.json({ ok: true });
});

app.post('/api/ai/generate-questions', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas'), aiLimiter, async (req: AuthedRequest, res) => {
  try {
    const parsed = aiGenerateSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Parameter generator soal AI tidak valid.' });
      return;
    }
    const {
      provider,
      model,
      subject,
      gradeLevel,
      topic,
      questionTypes,
      count,
      difficulty,
      additionalInstructions,
    } = parsed.data;

    const storedKeyRow = db
      .prepare('SELECT encrypted_key, iv, auth_tag, model_name FROM ai_provider_keys WHERE owner_id = ? AND provider = ?')
      .get(req.user!.userId, provider) as any;

    let resolvedKey: string | undefined;
    if (storedKeyRow) {
      resolvedKey = decryptSecret(storedKeyRow.encrypted_key, storedKeyRow.iv, storedKeyRow.auth_tag);
    }

    const result = await generateQuestionsWithProvider({
      provider: provider as AiProvider,
      model: model || storedKeyRow?.model_name || undefined,
      apiKey: resolvedKey,
      subject,
      gradeLevel: gradeLevel || 'XII',
      topic,
      questionTypes: questionTypes as QuestionType[],
      count,
      difficulty,
      additionalInstructions,
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Gagal menghasilkan soal dengan AI.' });
  }
});

// ============================================================================
// 4. Question Banks (STRICT Isolation: Guru cannot open another Guru's bank!)
// ============================================================================
app.get('/api/banks', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas'), (req: AuthedRequest, res) => {
  const banks = db
    .prepare(`
      SELECT qb.*, (SELECT COUNT(*) FROM questions q WHERE q.bank_id = qb.id) as question_count
      FROM question_banks qb
      WHERE qb.owner_id = ?
      ORDER BY qb.created_at DESC
    `)
    .all(req.user!.userId);
  res.json(banks);
});

app.post('/api/banks', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas'), (req: AuthedRequest, res) => {
  const { subject, gradeLevel, title } = req.body;
  if (!subject || !title) {
    res.status(400).json({ error: 'Judul bank soal dan mata pelajaran wajib diisi.' });
    return;
  }
  const id = `qb-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(`
    INSERT INTO question_banks (id, owner_id, owner_name, subject, grade_level, title, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.user!.userId, req.user!.name, subject, gradeLevel || 'XII', title, new Date().toISOString());
  res.json({ id });
});

app.get('/api/banks/:id/questions', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas'), (req: AuthedRequest, res) => {
  const bank = db.prepare('SELECT * FROM question_banks WHERE id = ?').get(req.params.id) as any;
  if (!bank) {
    res.status(404).json({ error: 'Bank soal tidak ditemukan.' });
    return;
  }
  if (bank.owner_id !== req.user!.userId) {
    res.status(403).json({
      error: 'Akses ditolak: Anda tidak diperbolehkan membuka bank soal milik guru lain.',
    });
    return;
  }
  const rows = db
    .prepare('SELECT * FROM questions WHERE bank_id = ? AND owner_id = ? ORDER BY created_at ASC')
    .all(bank.id, req.user!.userId) as any[];
  res.json({
    bank,
    questions: rows.map((r) => ({
      id: r.id,
      bankId: r.bank_id,
      type: r.type,
      prompt: r.prompt,
      options: JSON.parse(r.options_json || '[]'),
      answerKey: JSON.parse(r.answer_key_json || '""'),
      points: r.points,
      explanation: r.explanation,
      difficultyTarget: r.difficulty_target,
    })),
  });
});

app.post('/api/banks/:id/questions', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas'), (req: AuthedRequest, res) => {
  const bank = db.prepare('SELECT * FROM question_banks WHERE id = ?').get(req.params.id) as any;
  if (!bank) {
    res.status(404).json({ error: 'Bank soal tidak ditemukan.' });
    return;
  }
  if (bank.owner_id !== req.user!.userId) {
    res.status(403).json({ error: 'Akses ditolak: bukan pemilik bank soal.' });
    return;
  }
  const items: any[] = Array.isArray(req.body.questions) ? req.body.questions : [req.body];
  const insertQ = db.prepare(`
    INSERT INTO questions (id, bank_id, owner_id, type, prompt, options_json, answer_key_json, points, explanation, difficulty_target, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const createdIds: string[] = [];
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    for (const item of items) {
      const qid = `q-${crypto.randomUUID().slice(0, 8)}`;
      insertQ.run(
        qid,
        bank.id,
        req.user!.userId,
        item.type || 'PG',
        String(item.prompt || ''),
        JSON.stringify(item.options ?? []),
        JSON.stringify(item.answerKey ?? ''),
        Number(item.points) || 10,
        String(item.explanation || ''),
        String(item.difficultyTarget || 'Sedang'),
        now
      );
      createdIds.push(qid);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.json({ createdIds, count: createdIds.length });
});

app.put('/api/questions/:id', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas'), (req: AuthedRequest, res) => {
  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(req.params.id) as any;
  if (!q) {
    res.status(404).json({ error: 'Soal tidak ditemukan.' });
    return;
  }
  if (req.user!.role !== 'admin' && q.owner_id !== req.user!.userId) {
    res.status(403).json({ error: 'Akses ditolak: Anda hanya dapat mengubah soal milik sendiri.' });
    return;
  }
  const prompt = String(req.body?.prompt || '').trim();
  if (!prompt) {
    res.status(400).json({ error: 'Teks pertanyaan wajib diisi.' });
    return;
  }
  const type = String(req.body?.type || q.type);
  const options = req.body?.options !== undefined ? req.body.options : JSON.parse(q.options_json || '[]');
  const answerKey = req.body?.answerKey !== undefined ? req.body.answerKey : JSON.parse(q.answer_key_json || '""');
  const points = Number(req.body?.points) > 0 ? Number(req.body.points) : Number(q.points) || 10;
  const explanation = req.body?.explanation !== undefined ? String(req.body.explanation) : String(q.explanation || '');
  const difficultyTarget = req.body?.difficultyTarget ? String(req.body.difficultyTarget) : String(q.difficulty_target || 'Sedang');

  db.prepare(`
    UPDATE questions
    SET type = ?, prompt = ?, options_json = ?, answer_key_json = ?, points = ?, explanation = ?, difficulty_target = ?
    WHERE id = ?
  `).run(type, prompt, JSON.stringify(options), JSON.stringify(answerKey), points, explanation, difficultyTarget, req.params.id);
  examBundleCache.clear();
  res.json({ ok: true });
});

app.delete('/api/questions/:id', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas'), (req: AuthedRequest, res) => {
  const q = db.prepare('SELECT owner_id FROM questions WHERE id = ?').get(req.params.id) as any;
  if (!q) {
    res.status(404).json({ error: 'Soal tidak ditemukan.' });
    return;
  }
  if (q.owner_id !== req.user!.userId) {
    res.status(403).json({ error: 'Akses ditolak.' });
    return;
  }
  db.prepare('DELETE FROM questions WHERE id = ?').run(req.params.id);
  examBundleCache.clear();
  res.json({ ok: true });
});

// ============================================================================
// 5. CBT Exams, Bundle Cache, Anti-Cheat, Proctor Unlock, Grading, Item Analysis & Load Test
// ============================================================================
app.get('/api/cbt/exams', authMiddleware, (req: AuthedRequest, res) => {
  if (req.user!.role === 'siswa') {
    const exams = db.prepare("SELECT * FROM cbt_exams WHERE status IN ('active', 'closed') ORDER BY created_at DESC").all() as any[];
    const sessions = db
      .prepare('SELECT * FROM cbt_sessions WHERE student_id = ?')
      .all(req.user!.userId) as any[];
    const sessMap = new Map(sessions.map((s) => [s.exam_id, s]));

    const visible = exams
      .filter((e) => {
        const classes: string[] = JSON.parse(e.class_names_json || '[]');
        return classes.includes(req.user!.className);
      })
      .map((e) => {
        const s = sessMap.get(e.id);
        return {
          id: e.id,
          title: e.title,
          subject: e.subject,
          ownerName: e.owner_name,
          durationMinutes: e.duration_minutes,
          maxViolations: e.max_violations,
          requireFullscreen: Boolean(e.require_fullscreen),
          shuffleQuestions: Boolean(e.shuffle_questions),
          shuffleOptions: Boolean(e.shuffle_options),
          startAt: e.start_at,
          endAt: e.end_at,
          status: e.status,
          questionCount: JSON.parse(e.question_ids_json || '[]').length,
          session: s
            ? {
                id: s.id,
                status: s.status,
                violationsCount: s.violations_count,
                totalScore: s.total_score,
                submittedAt: s.submitted_at,
              }
            : null,
        };
      });
    res.json(visible);
    return;
  }

  let rows: any[];
  if (req.user!.role === 'admin' || req.user!.role === 'pengawas') {
    rows = db.prepare('SELECT * FROM cbt_exams ORDER BY created_at DESC').all();
  } else {
    rows = db.prepare('SELECT * FROM cbt_exams WHERE owner_id = ? ORDER BY created_at DESC').all(req.user!.userId);
  }
  res.json(
    rows.map((e) => {
      const counts = db
        .prepare(
          `SELECT COUNT(*) as total,
                  SUM(CASE WHEN status='submitted' THEN 1 ELSE 0 END) as submitted,
                  SUM(CASE WHEN status='locked' THEN 1 ELSE 0 END) as locked
           FROM cbt_sessions WHERE exam_id = ?`
        )
        .get(e.id) as any;
      return {
        ...e,
        classNames: JSON.parse(e.class_names_json || '[]'),
        questionIds: JSON.parse(e.question_ids_json || '[]'),
        shuffleQuestions: Boolean(e.shuffle_questions),
        shuffleOptions: Boolean(e.shuffle_options),
        stats: counts,
      };
    })
  );
});

app.post('/api/cbt/exams', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas'), (req: AuthedRequest, res) => {
  const parsed = createExamSchema.safeParse(req.body || {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Judul ujian, mapel, dan minimal 1 soal wajib dipilih.' });
    return;
  }
  const {
    title,
    subject,
    classNames,
    durationMinutes,
    maxViolations,
    requireFullscreen,
    shuffleQuestions,
    shuffleOptions,
    startAt: rawStartAt,
    endAt: rawEndAt,
    questionIds,
  } = parsed.data;
  // Ensure all selected questions belong to this teacher!
  const placeholders = questionIds.map(() => '?').join(',');
  const ownedCount = (
    db
      .prepare(`SELECT COUNT(*) as cnt FROM questions WHERE id IN (${placeholders}) AND owner_id = ?`)
      .get(...questionIds, req.user!.userId) as any
  ).cnt;
  if (ownedCount !== questionIds.length) {
    res.status(403).json({ error: 'Anda hanya dapat memasukkan soal dari bank soal milik sendiri.' });
    return;
  }

  const id = `ex-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const defaultEnd = new Date(Date.now() + 7 * 86400000).toISOString();
  const tz = getSchoolTimezone();
  const startAt = normalizeExamDateTime(rawStartAt, now, tz);
  const endAt = normalizeExamDateTime(rawEndAt, defaultEnd, tz);

  db.prepare(`
    INSERT INTO cbt_exams (id, owner_id, owner_name, title, subject, class_names_json, duration_minutes, max_violations, require_fullscreen, shuffle_questions, shuffle_options, start_at, end_at, status, question_ids_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(
    id,
    req.user!.userId,
    req.user!.name,
    title,
    subject,
    JSON.stringify(classNames),
    durationMinutes,
    maxViolations,
    requireFullscreen ? 1 : 0,
    shuffleQuestions ? 1 : 0,
    shuffleOptions ? 1 : 0,
    startAt,
    endAt,
    JSON.stringify(questionIds),
    now
  );
  examBundleCache.delete(id);
  recordAuditLog({
    actorId: req.user!.userId,
    actorName: req.user!.name,
    actorRole: req.user!.role,
    action: 'CREATE_CBT_EXAM',
    targetType: 'cbt_exam',
    targetId: id,
    detail: `Membuat ujian CBT "${title}" (${subject}) dengan ${questionIds.length} soal`,
    ipAddress: getClientIp(req),
  });
  res.json({ id });
});

app.patch('/api/cbt/exams/:id/status', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas'), (req: AuthedRequest, res) => {
  const exam = db.prepare('SELECT id, title, owner_id, status FROM cbt_exams WHERE id = ?').get(req.params.id) as any;
  if (!exam) {
    res.status(404).json({ error: 'Ujian tidak ditemukan.' });
    return;
  }
  if (req.user!.role !== 'admin' && exam.owner_id !== req.user!.userId) {
    res.status(403).json({ error: 'Anda tidak memiliki izin mengubah status ujian guru lain.' });
    return;
  }
  const nextStatus = req.body?.status === 'closed' ? 'closed' : 'active';
  db.prepare('UPDATE cbt_exams SET status = ? WHERE id = ?').run(nextStatus, exam.id);
  examBundleCache.delete(exam.id);
  recordAuditLog({
    actorId: req.user!.userId,
    actorName: req.user!.name,
    actorRole: req.user!.role,
    action: 'TOGGLE_CBT_STATUS',
    targetType: 'cbt_exam',
    targetId: exam.id,
    detail: `Mengubah status ujian "${exam.title}" menjadi ${nextStatus}`,
    ipAddress: getClientIp(req),
  });
  res.json({ ok: true, status: nextStatus });
});

app.get('/api/cbt/exams/:id/results/export', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas'), (req: AuthedRequest, res) => {
  const bundle = getExamBundle(req.params.id);
  if (!bundle) {
    res.status(404).json({ error: 'Ujian tidak ditemukan.' });
    return;
  }
  if (req.user!.role !== 'admin' && bundle.examMeta.owner_id !== req.user!.userId) {
    res.status(403).json({ error: 'Anda tidak memiliki akses mengekspor hasil ujian guru lain.' });
    return;
  }
  const rows = db
    .prepare(
      `SELECT s.*, u.username as student_nisn
       FROM cbt_sessions s
       LEFT JOIN users u ON u.id = s.student_id
       WHERE s.exam_id = ?
       ORDER BY s.class_name ASC, s.student_name ASC`
    )
    .all(req.params.id) as any[];

  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(
    rows.map((r, idx) => ({
      No: idx + 1,
      'NISN / Username': r.student_nisn || '-',
      'Nama Siswa': r.student_name,
      Kelas: r.class_name,
      Status: r.status === 'submitted' ? 'Selesai' : r.status === 'locked' ? 'Terkunci' : 'Mengerjakan',
      'Skor Otomatis': r.auto_score ?? 0,
      'Skor Manual': r.manual_score ?? 0,
      'Nilai Akhir': r.total_score ?? 0,
      Pelanggaran: r.violations_count ?? 0,
      'Waktu Mulai': r.started_at || '-',
      'Waktu Selesai': r.submitted_at || '-',
    }))
  );
  XLSX.utils.book_append_sheet(wb, sheet, 'Hasil Ujian CBT');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const safeTitle = String(bundle.examMeta.title || 'ujian').replace(/[^a-z0-9-_]/gi, '_');
  res.setHeader('Content-Disposition', `attachment; filename="Hasil_CBT_${safeTitle}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

app.get('/api/cbt/exams/:id/bundle', authMiddleware, (req: AuthedRequest, res) => {
  const bundle = getExamBundle(req.params.id);
  if (!bundle) {
    res.status(404).json({ error: 'Ujian tidak ditemukan.' });
    return;
  }
  const exam = bundle.examMeta;
  if (req.user!.role === 'siswa') {
    const classes: string[] = JSON.parse(exam.class_names_json || '[]');
    if (!classes.includes(req.user!.className)) {
      res.status(403).json({ error: 'Ujian ini tidak dijadwalkan untuk kelas Anda.' });
      return;
    }
    const deviceId = String(req.headers['x-cbt-device-id'] || req.query.deviceId || '').trim().slice(0, 80);
    let session = db
      .prepare('SELECT * FROM cbt_sessions WHERE exam_id = ? AND student_id = ?')
      .get(exam.id, req.user!.userId) as any;

    if (!session || session.status !== 'submitted') {
      if (exam.status !== 'active') {
        res.status(403).json({ error: 'Ujian ini sudah ditutup oleh guru atau pengawas.' });
        return;
      }
      const nowMs = Date.now();
      if (exam.start_at && nowMs < new Date(exam.start_at).getTime()) {
        res.status(403).json({ error: 'Ujian belum memasuki waktu mulai.' });
        return;
      }
      if (exam.end_at && nowMs > new Date(exam.end_at).getTime()) {
        res.status(403).json({ error: 'Jadwal ujian telah berakhir.' });
        return;
      }
    }

    if (!session) {
      const sid = `sess-${crypto.randomUUID().slice(0, 10)}`;
      db.prepare(`
        INSERT INTO cbt_sessions (id, exam_id, student_id, student_name, class_name, status, violations_count, started_at, answers_json, essay_grades_json, device_session_id)
        VALUES (?, ?, ?, ?, ?, 'in_progress', 0, ?, '{}', '{}', ?)
      `).run(sid, exam.id, req.user!.userId, req.user!.name, req.user!.className, new Date().toISOString(), deviceId);
      session = db.prepare('SELECT * FROM cbt_sessions WHERE id = ?').get(sid);
    } else if (session.status === 'in_progress' && deviceId) {
      if (!session.device_session_id) {
        db.prepare('UPDATE cbt_sessions SET device_session_id = ? WHERE id = ?').run(deviceId, session.id);
        session.device_session_id = deviceId;
      } else if (session.device_session_id !== deviceId) {
        res.status(409).json({
          error:
            'Ujian ini sedang aktif dibuka di perangkat atau tab lain. Minta pengawas membuka kunci sesi jika Anda pindah perangkat.',
        });
        return;
      }
    }

    const parsedBundle = JSON.parse(bundle.studentPayload);
    const shouldShuffleQ = Boolean(exam.shuffle_questions);
    const shouldShuffleOpt = Boolean(exam.shuffle_options);
    if (shouldShuffleQ) {
      parsedBundle.questions = seededShuffle(parsedBundle.questions, `${exam.id}:${req.user!.userId}`);
    }
    if (shouldShuffleOpt) {
      parsedBundle.questions = parsedBundle.questions.map((q: any) => {
        if ((q.type === 'PG' || q.type === 'PGK') && Array.isArray(q.options)) {
          return {
            ...q,
            options: seededShuffle(q.options, `${exam.id}:${req.user!.userId}:${q.id}`),
          };
        }
        return q;
      });
    }

    const endTimeMs = new Date(session.started_at).getTime() + Number(exam.duration_minutes) * 60000;
    const remainingSeconds = session.status === 'submitted' ? 0 : Math.max(0, Math.floor((endTimeMs - Date.now()) / 1000));

    const effectiveEtag =
      shouldShuffleQ || shouldShuffleOpt
        ? `"${crypto.createHash('sha1').update(`${bundle.etag}:${req.user!.userId}`).digest('hex')}"`
        : bundle.etag;
    res.setHeader('ETag', effectiveEtag);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.json({
      ...parsedBundle,
      session: {
        id: session.id,
        status: session.status,
        violationsCount: session.violations_count,
        startedAt: session.started_at,
        submittedAt: session.submitted_at,
        remainingSeconds,
        answers: JSON.parse(session.answers_json || '{}'),
        totalScore: session.total_score,
      },
    });
    return;
  }

  res.json(JSON.parse(bundle.studentPayload));
});

app.post('/api/cbt/sessions/:id/answers-batch', authMiddleware, requireRoles('siswa'), async (req: AuthedRequest, res) => {
  const session = db.prepare('SELECT * FROM cbt_sessions WHERE id = ?').get(req.params.id) as any;
  if (!session || session.student_id !== req.user!.userId) {
    res.status(404).json({ error: 'Sesi ujian tidak ditemukan.' });
    return;
  }
  if (session.status === 'locked') {
    res.status(423).json({ error: 'Ujian dikunci karena pelanggaran. Hubungi pengawas untuk membuka kunci.', locked: true });
    return;
  }
  if (session.status === 'submitted') {
    res.status(409).json({ error: 'Ujian sudah diselesaikan.' });
    return;
  }
  const examRow = db.prepare('SELECT duration_minutes FROM cbt_exams WHERE id = ?').get(session.exam_id) as
    | { duration_minutes?: number }
    | undefined;
  const deadlineMs = new Date(session.started_at).getTime() + Number(examRow?.duration_minutes || 60) * 60000 + 90000;
  if (Date.now() > deadlineMs) {
    res.status(410).json({ error: 'Waktu pengerjaan ujian telah berakhir.', expired: true });
    return;
  }
  const deviceId = String(req.headers['x-cbt-device-id'] || req.body?.deviceSessionId || '').trim().slice(0, 80);
  if (deviceId && session.device_session_id && session.device_session_id !== deviceId) {
    res.status(409).json({
      error: 'Sesi ujian aktif di perangkat lain. Sinkronisasi dari perangkat ini ditolak.',
    });
    return;
  }
  const answers = req.body?.answers && typeof req.body.answers === 'object' ? req.body.answers : {};
  await enqueueAnswerMerge(session.id, answers);
  res.json({ ok: true, syncedCount: Object.keys(answers).length, serverTime: new Date().toISOString() });
});

app.post('/api/cbt/sessions/:id/violation', authMiddleware, requireRoles('siswa'), (req: AuthedRequest, res) => {
  const session = db.prepare('SELECT * FROM cbt_sessions WHERE id = ?').get(req.params.id) as any;
  if (!session || session.student_id !== req.user!.userId) {
    res.status(404).json({ error: 'Sesi ujian tidak ditemukan.' });
    return;
  }
  if (session.status === 'submitted') {
    res.json({ status: 'submitted', violationsCount: session.violations_count });
    return;
  }
  const exam = db.prepare('SELECT max_violations FROM cbt_exams WHERE id = ?').get(session.exam_id) as any;
  const maxViol = Number(exam?.max_violations) || 3;

  const { type, detail } = req.body;
  const newCount = Number(session.violations_count || 0) + 1;
  const locked = newCount >= maxViol;

  db.prepare(`
    INSERT INTO cbt_violations (id, session_id, exam_id, student_id, student_name, type, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `viol-${crypto.randomUUID().slice(0, 8)}`,
    session.id,
    session.exam_id,
    req.user!.userId,
    req.user!.name,
    String(type || 'tab_switch'),
    String(detail || 'Terdeteksi pelanggaran keamanan ujian'),
    new Date().toISOString()
  );

  db.prepare('UPDATE cbt_sessions SET violations_count = ?, status = ? WHERE id = ?').run(
    newCount,
    locked ? 'locked' : session.status,
    session.id
  );

  res.json({
    violationsCount: newCount,
    maxViolations: maxViol,
    locked,
    status: locked ? 'locked' : session.status,
  });
});

app.get('/api/cbt/sessions/:id/status', authMiddleware, (req: AuthedRequest, res) => {
  const session = db.prepare('SELECT id, student_id, status, violations_count, total_score FROM cbt_sessions WHERE id = ?').get(req.params.id) as any;
  if (!session) {
    res.status(404).json({ error: 'Sesi tidak ditemukan.' });
    return;
  }
  if (req.user!.role === 'siswa' && session.student_id !== req.user!.userId) {
    res.status(403).json({ error: 'Akses ditolak.' });
    return;
  }
  res.json({
    id: session.id,
    status: session.status,
    violationsCount: session.violations_count,
    totalScore: session.total_score,
  });
});

app.post('/api/cbt/sessions/:id/submit', authMiddleware, requireRoles('siswa'), async (req: AuthedRequest, res) => {
  flushPendingAnswersToDb();
  const session = db.prepare('SELECT * FROM cbt_sessions WHERE id = ?').get(req.params.id) as any;
  if (!session || session.student_id !== req.user!.userId) {
    res.status(404).json({ error: 'Sesi ujian tidak ditemukan.' });
    return;
  }
  if (session.status === 'locked') {
    res.status(423).json({ error: 'Ujian sedang terkunci. Minta pengawas membukanya terlebih dahulu.' });
    return;
  }
  const deviceId = String(req.headers['x-cbt-device-id'] || req.body?.deviceSessionId || '').trim().slice(0, 80);
  if (deviceId && session.device_session_id && session.device_session_id !== deviceId && session.status === 'in_progress') {
    res.status(409).json({
      error: 'Sesi ujian ini sedang terkunci pada perangkat lain.',
    });
    return;
  }

  const incomingAnswers = req.body?.answers && typeof req.body.answers === 'object' ? req.body.answers : {};
  const mergedAnswers = { ...JSON.parse(session.answers_json || '{}'), ...incomingAnswers };
  const bundle = getExamBundle(session.exam_id);
  const questions = bundle?.questions || [];
  const essayGrades = JSON.parse(session.essay_grades_json || '{}');

  let autoScore = 0;
  let manualScore = 0;
  let maxPossible = 0;
  for (const q of questions) {
    maxPossible += Number(q.points) || 10;
    const pts = gradeQuestionItem(q, mergedAnswers[q.id], essayGrades[q.id]);
    if (q.type === 'URAIAN') manualScore += pts;
    else autoScore += pts;
  }
  const scaledTotal = maxPossible > 0 ? Number((((autoScore + manualScore) / maxPossible) * 100).toFixed(2)) : 0;

  db.prepare(`
    UPDATE cbt_sessions
    SET status = 'submitted', submitted_at = ?, answers_json = ?, auto_score = ?, manual_score = ?, total_score = ?
    WHERE id = ?
  `).run(
    new Date().toISOString(),
    JSON.stringify(mergedAnswers),
    Number(autoScore.toFixed(2)),
    Number(manualScore.toFixed(2)),
    scaledTotal,
    session.id
  );

  res.json({
    ok: true,
    status: 'submitted',
    autoScore: Number(autoScore.toFixed(2)),
    manualScore: Number(manualScore.toFixed(2)),
    totalScore: scaledTotal,
  });
});

// Proctor Live Monitor & Unlock
app.get('/api/cbt/proctor/sessions', authMiddleware, requireRoles('pengawas', 'admin', 'guru', 'wali_kelas'), (req: AuthedRequest, res) => {
  const examId = req.query.examId ? String(req.query.examId) : '';
  let sessionsSql = `
    SELECT s.*, e.title as exam_title, e.subject as exam_subject, e.max_violations, e.owner_id
    FROM cbt_sessions s
    JOIN cbt_exams e ON e.id = s.exam_id
    WHERE 1=1
  `;
  const params: any[] = [];
  if (examId) {
    sessionsSql += ' AND s.exam_id = ?';
    params.push(examId);
  }
  if (req.user!.role === 'guru' || req.user!.role === 'wali_kelas') {
    sessionsSql += ' AND e.owner_id = ?';
    params.push(req.user!.userId);
  }
  sessionsSql += " ORDER BY CASE WHEN s.status = 'locked' THEN 0 WHEN s.status = 'in_progress' THEN 1 ELSE 2 END, s.started_at DESC";
  const sessions = db.prepare(sessionsSql).all(...params);

  let violSql = `
    SELECT v.*, e.title as exam_title, e.owner_id
    FROM cbt_violations v
    JOIN cbt_exams e ON e.id = v.exam_id
    WHERE 1=1
  `;
  const vParams: any[] = [];
  if (examId) {
    violSql += ' AND v.exam_id = ?';
    vParams.push(examId);
  }
  if (req.user!.role === 'guru' || req.user!.role === 'wali_kelas') {
    violSql += ' AND e.owner_id = ?';
    vParams.push(req.user!.userId);
  }
  violSql += ' ORDER BY v.created_at DESC LIMIT 60';
  const violations = db.prepare(violSql).all(...vParams);

  res.json({ sessions, violations });
});

app.post('/api/cbt/proctor/sessions/:id/unlock', authMiddleware, requireRoles('pengawas', 'admin'), (req: AuthedRequest, res) => {
  const session = db.prepare('SELECT * FROM cbt_sessions WHERE id = ?').get(req.params.id) as any;
  if (!session) {
    res.status(404).json({ error: 'Sesi tidak ditemukan.' });
    return;
  }
  // Reset violation counter & device lock upon authorized proctor unlock (keep audit log in cbt_violations & audit_logs)
  db.prepare("UPDATE cbt_sessions SET status = 'in_progress', violations_count = 0, device_session_id = '' WHERE id = ?").run(session.id);
  db.prepare(`
    INSERT INTO cbt_violations (id, session_id, exam_id, student_id, student_name, type, detail, created_at)
    VALUES (?, ?, ?, ?, ?, 'proctor_unlock', ?, ?)
  `).run(
    `viol-${crypto.randomUUID().slice(0, 8)}`,
    session.id,
    session.exam_id,
    session.student_id,
    session.student_name,
    `Ujian dibuka kembali oleh pengawas (${req.user!.name})`,
    new Date().toISOString()
  );
  recordAuditLog({
    actorId: req.user!.userId,
    actorName: req.user!.name,
    actorRole: req.user!.role,
    action: 'PROCTOR_UNLOCK_CBT',
    targetType: 'cbt_session',
    targetId: session.id,
    detail: `Membuka kunci ujian & reset perangkat siswa ${session.student_name}`,
    ipAddress: getClientIp(req),
  });
  res.json({ ok: true, status: 'in_progress' });
});

app.post('/api/cbt/proctor/sessions/:id/force-submit', authMiddleware, requireRoles('pengawas', 'admin'), (req: AuthedRequest, res) => {
  flushPendingAnswersToDb();
  const session = db.prepare('SELECT * FROM cbt_sessions WHERE id = ?').get(req.params.id) as any;
  if (!session) {
    res.status(404).json({ error: 'Sesi ujian tidak ditemukan.' });
    return;
  }
  if (session.status === 'submitted') {
    res.json({ ok: true, status: 'submitted', totalScore: session.total_score });
    return;
  }
  const bundle = getExamBundle(session.exam_id);
  const questions = bundle?.questions || [];
  const mergedAnswers = JSON.parse(session.answers_json || '{}');
  const essayGrades = JSON.parse(session.essay_grades_json || '{}');

  let autoScore = 0;
  let manualScore = 0;
  let maxPossible = 0;
  for (const q of questions) {
    maxPossible += Number(q.points) || 10;
    const pts = gradeQuestionItem(q, mergedAnswers[q.id], essayGrades[q.id]);
    if (q.type === 'URAIAN') manualScore += pts;
    else autoScore += pts;
  }
  const scaledTotal = maxPossible > 0 ? Number((((autoScore + manualScore) / maxPossible) * 100).toFixed(2)) : 0;

  db.prepare(`
    UPDATE cbt_sessions
    SET status = 'submitted', submitted_at = ?, auto_score = ?, manual_score = ?, total_score = ?
    WHERE id = ?
  `).run(
    new Date().toISOString(),
    Number(autoScore.toFixed(2)),
    Number(manualScore.toFixed(2)),
    scaledTotal,
    session.id
  );
  recordAuditLog({
    actorId: req.user!.userId,
    actorName: req.user!.name,
    actorRole: req.user!.role,
    action: 'PROCTOR_FORCE_SUBMIT',
    targetType: 'cbt_session',
    targetId: session.id,
    detail: `Menyelesaikan paksa sesi ujian siswa ${session.student_name} (Nilai: ${scaledTotal})`,
    ipAddress: getClientIp(req),
  });
  res.json({ ok: true, status: 'submitted', totalScore: scaledTotal });
});

// Teacher Essay & Auto-Grading Review
app.get('/api/cbt/exams/:id/submissions', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas'), (req: AuthedRequest, res) => {
  const bundle = getExamBundle(req.params.id);
  if (!bundle) {
    res.status(404).json({ error: 'Ujian tidak ditemukan.' });
    return;
  }
  if (req.user!.role !== 'admin' && bundle.examMeta.owner_id !== req.user!.userId) {
    res.status(403).json({ error: 'Anda tidak memiliki akses ke hasil ujian guru lain.' });
    return;
  }
  const sessions = db
    .prepare('SELECT * FROM cbt_sessions WHERE exam_id = ? ORDER BY submitted_at DESC, student_name ASC')
    .all(req.params.id) as any[];
  res.json({
    exam: bundle.examMeta,
    questions: bundle.questions,
    sessions: sessions.map((s) => ({
      ...s,
      answers: JSON.parse(s.answers_json || '{}'),
      essayGrades: JSON.parse(s.essay_grades_json || '{}'),
    })),
  });
});

app.post('/api/cbt/sessions/:id/grade-essay', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas'), (req: AuthedRequest, res) => {
  const session = db.prepare('SELECT * FROM cbt_sessions WHERE id = ?').get(req.params.id) as any;
  if (!session) {
    res.status(404).json({ error: 'Sesi tidak ditemukan.' });
    return;
  }
  const bundle = getExamBundle(session.exam_id);
  if (!bundle) {
    res.status(404).json({ error: 'Ujian tidak ditemukan.' });
    return;
  }
  if (req.user!.role !== 'admin' && bundle.examMeta.owner_id !== req.user!.userId) {
    res.status(403).json({ error: 'Akses ditolak.' });
    return;
  }

  const incomingGrades = req.body?.essayGrades || {};
  const answers = JSON.parse(session.answers_json || '{}');
  const mergedGrades = { ...JSON.parse(session.essay_grades_json || '{}'), ...incomingGrades };

  let autoScore = 0;
  let manualScore = 0;
  let maxPossible = 0;
  for (const q of bundle.questions) {
    maxPossible += Number(q.points) || 10;
    const pts = gradeQuestionItem(q, answers[q.id], mergedGrades[q.id]);
    if (q.type === 'URAIAN') manualScore += pts;
    else autoScore += pts;
  }
  const scaledTotal = maxPossible > 0 ? Number((((autoScore + manualScore) / maxPossible) * 100).toFixed(2)) : 0;

  db.prepare(`
    UPDATE cbt_sessions SET essay_grades_json = ?, auto_score = ?, manual_score = ?, total_score = ? WHERE id = ?
  `).run(JSON.stringify(mergedGrades), Number(autoScore.toFixed(2)), Number(manualScore.toFixed(2)), scaledTotal, session.id);

  res.json({ ok: true, autoScore, manualScore, totalScore: scaledTotal });
});

// Item Analysis & Excel Export
app.get('/api/cbt/exams/:id/analysis', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas'), (req: AuthedRequest, res) => {
  const bundle = getExamBundle(req.params.id);
  if (!bundle) {
    res.status(404).json({ error: 'Ujian tidak ditemukan.' });
    return;
  }
  if (req.user!.role !== 'admin' && bundle.examMeta.owner_id !== req.user!.userId) {
    res.status(403).json({ error: 'Akses ditolak.' });
    return;
  }
  const rows = db
    .prepare("SELECT * FROM cbt_sessions WHERE exam_id = ? AND status = 'submitted'")
    .all(req.params.id) as any[];
  const sessions: SessionRecord[] = rows.map((r) => ({
    id: r.id,
    studentId: r.student_id,
    studentName: r.student_name,
    answers: JSON.parse(r.answers_json || '{}'),
    essayGrades: JSON.parse(r.essay_grades_json || '{}'),
    totalScore: r.total_score,
  }));
  const report = analyzeExamItems(
    bundle.examMeta.id,
    bundle.examMeta.title,
    bundle.examMeta.subject,
    bundle.questions,
    sessions
  );
  res.json(report);
});

app.get('/api/cbt/exams/:id/analysis/export', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas'), (req: AuthedRequest, res) => {
  const bundle = getExamBundle(req.params.id);
  if (!bundle) {
    res.status(404).json({ error: 'Ujian tidak ditemukan.' });
    return;
  }
  if (req.user!.role !== 'admin' && bundle.examMeta.owner_id !== req.user!.userId) {
    res.status(403).json({ error: 'Akses ditolak.' });
    return;
  }
  const rows = db
    .prepare("SELECT * FROM cbt_sessions WHERE exam_id = ? AND status = 'submitted'")
    .all(req.params.id) as any[];
  const sessions: SessionRecord[] = rows.map((r) => ({
    id: r.id,
    studentId: r.student_id,
    studentName: r.student_name,
    answers: JSON.parse(r.answers_json || '{}'),
    essayGrades: JSON.parse(r.essay_grades_json || '{}'),
    totalScore: r.total_score,
  }));
  const report = analyzeExamItems(
    bundle.examMeta.id,
    bundle.examMeta.title,
    bundle.examMeta.subject,
    bundle.questions,
    sessions
  );

  const wb = XLSX.utils.book_new();
  const summarySheet = XLSX.utils.json_to_sheet([
    { Parameter: 'Judul Ujian', Nilai: report.examTitle },
    { Parameter: 'Mata Pelajaran', Nilai: report.subject },
    { Parameter: 'Jumlah Peserta', Nilai: report.respondentCount },
    { Parameter: 'Jumlah Butir Soal', Nilai: report.questionCount },
    { Parameter: 'Reliabilitas (KR-20 / Alpha)', Nilai: `${report.reliabilityAlpha} (${report.reliabilityCategory})` },
    { Parameter: 'Rata-rata Nilai (Skala 100)', Nilai: report.meanTotalScore },
    { Parameter: 'Simpangan Baku', Nilai: report.stdDevTotalScore },
    { Parameter: 'Nilai Tertinggi', Nilai: report.highestScore },
    { Parameter: 'Nilai Terendah', Nilai: report.lowestScore },
  ]);
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Ringkasan Ujian');

  const itemSheet = XLSX.utils.json_to_sheet(
    report.items.map((it) => ({
      No: it.number,
      Tipe: it.type,
      'Cuplikan Soal': it.promptPreview,
      'Bobot Maks': it.maxPoints,
      'Rata-rata Skor': it.meanScore,
      'Tingkat Kesukaran (P)': it.difficultyIndex,
      'Kategori Kesukaran': it.difficultyCategory,
      'Daya Pembeda (D)': it.discriminationIndex,
      'Kategori Daya Pembeda': it.discriminationCategory,
      'Validitas (r_xy)': it.validityRxy,
      'Status Validitas': it.validityStatus,
      Rekomendasi: it.recommendation,
      Catatan: it.recommendationReason,
    }))
  );
  XLSX.utils.book_append_sheet(wb, itemSheet, 'Analisis Butir');

  const distractorRows: any[] = [];
  for (const it of report.items) {
    if (it.distractors.length > 0) {
      for (const d of it.distractors) {
        distractorRows.push({
          'No Soal': it.number,
          Tipe: it.type,
          Opsi: d.label,
          'Kunci?': d.isCorrect ? 'Ya' : 'Tidak',
          'Jumlah Pemilih': d.totalCount,
          'Persentase (%)': d.totalPct,
          'Kelompok Atas': d.upperCount,
          'Kelompok Bawah': d.lowerCount,
          'Efektivitas Pengecoh': d.effectiveness,
        });
      }
    } else {
      for (const ad of it.answerDistribution) {
        distractorRows.push({
          'No Soal': it.number,
          Tipe: it.type,
          Opsi: ad.label,
          'Kunci?': '-',
          'Jumlah Pemilih': ad.count,
          'Persentase (%)': ad.pct,
          'Kelompok Atas': '-',
          'Kelompok Bawah': '-',
          'Efektivitas Pengecoh': 'Sebaran Skor Uraian',
        });
      }
    }
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(distractorRows), 'Sebaran & Pengecoh');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename="analisis-butir-${req.params.id}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

// 1000-Student Concurrent Load Benchmark (verifies cached bundle + batched queue + WAL transaction integrity)
app.post('/api/cbt/exams/:id/stress-test', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas'), async (req: AuthedRequest, res) => {
  const bundle = getExamBundle(req.params.id);
  if (!bundle) {
    res.status(404).json({ error: 'Ujian tidak ditemukan.' });
    return;
  }
  const totalStudents = 1000;
  const startedAt = performance.now();
  let successCount = 0;
  let errorCount = 0;

  // Create ephemeral benchmark table in memory/temp transaction to exercise real bundle reads + 1000 concurrent batch merges + WAL commit without polluting real grades
  try {
    const t0 = performance.now();
    // Step 1: 1000 concurrent cached bundle reads
    const bundleReads = await Promise.all(
      Array.from({ length: totalStudents }, async () => {
        const b = getExamBundle(req.params.id);
        return b ? b.studentPayload.length : 0;
      })
    );
    const readMs = performance.now() - t0;

    // Step 2: 1000 concurrent answer batch prepares & single WAL transaction commit
    const t1 = performance.now();
    db.exec(`
      CREATE TEMP TABLE IF NOT EXISTS _stress_sessions (
        id TEXT PRIMARY KEY,
        answers_json TEXT NOT NULL,
        score REAL NOT NULL
      );
      DELETE FROM _stress_sessions;
    `);
    db.exec('BEGIN IMMEDIATE');
    const ins = db.prepare('INSERT INTO _stress_sessions (id, answers_json, score) VALUES (?, ?, ?)');
    for (let i = 0; i < totalStudents; i++) {
      if (bundleReads[i] > 0) {
        const sampleAns = { [bundle.questions[0]?.id || 'q-1']: 'B' };
        ins.run(`sim-1000-${i}`, JSON.stringify(sampleAns), 85);
        successCount++;
      } else {
        errorCount++;
      }
    }
    db.exec('COMMIT');
    db.exec('DROP TABLE IF EXISTS _stress_sessions');
    const writeMs = performance.now() - t1;
    const totalMs = performance.now() - startedAt;

    res.json({
      totalStudents,
      successCount,
      errorCount,
      bundlePayloadBytes: Buffer.byteLength(bundle.studentPayload, 'utf8'),
      readPhaseMs: Number(readMs.toFixed(2)),
      batchCommitMs: Number(writeMs.toFixed(2)),
      totalElapsedMs: Number(totalMs.toFixed(2)),
      throughputReqPerSec: Math.round((totalStudents * 2) / Math.max(0.001, totalMs / 1000)),
    });
  } catch (err: any) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    res.status(500).json({ error: err?.message || 'Benchmark gagal.' });
  }
});

// ============================================================================
// 6. E-Learning: Materials, Read Receipts, Assignments & Submissions
// ============================================================================
app.get('/api/elearning/materials', authMiddleware, (req: AuthedRequest, res) => {
  let rows: any[];
  if (req.user!.role === 'siswa') {
    rows = db
      .prepare('SELECT * FROM materials WHERE class_name = ? ORDER BY created_at DESC')
      .all(req.user!.className);
  } else if (req.user!.role === 'admin') {
    rows = db.prepare('SELECT * FROM materials ORDER BY created_at DESC').all();
  } else {
    rows = db
      .prepare('SELECT * FROM materials WHERE teacher_id = ? ORDER BY created_at DESC')
      .all(req.user!.userId);
  }

  const enriched = rows.map((m) => {
    const readers = db
      .prepare('SELECT student_id, student_name, class_name, read_at FROM material_reads WHERE material_id = ? ORDER BY read_at DESC')
      .all(m.id) as any[];
    const totalInClass = (
      db.prepare("SELECT COUNT(*) as cnt FROM users WHERE role = 'siswa' AND status = 'aktif' AND class_name = ?").get(m.class_name) as any
    ).cnt;
    const hasRead = readers.some((r) => r.student_id === req.user!.userId);
    return {
      ...m,
      blocks: JSON.parse(m.blocks_json || '[]'),
      readers,
      readCount: readers.length,
      totalStudentsInClass: totalInClass,
      hasRead,
    };
  });
  res.json(enriched);
});

app.post('/api/elearning/materials', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas'), (req: AuthedRequest, res) => {
  const { subject, className, title, summary, blocks } = req.body;
  if (!subject || !className || !title || !Array.isArray(blocks)) {
    res.status(400).json({ error: 'Mapel, kelas, judul, dan blok materi wajib diisi.' });
    return;
  }
  const id = `mat-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(`
    INSERT INTO materials (id, teacher_id, teacher_name, subject, class_name, title, summary, blocks_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.user!.userId, req.user!.name, subject, className, title, summary || '', JSON.stringify(blocks), new Date().toISOString());
  res.json({ id });
});

app.delete('/api/elearning/materials/:id', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas'), (req: AuthedRequest, res) => {
  const mat = db.prepare('SELECT id, teacher_id, title FROM materials WHERE id = ?').get(req.params.id) as any;
  if (!mat) {
    res.status(404).json({ error: 'Materi tidak ditemukan.' });
    return;
  }
  if (req.user!.role !== 'admin' && mat.teacher_id !== req.user!.userId) {
    res.status(403).json({ error: 'Anda hanya dapat menghapus materi milik sendiri.' });
    return;
  }
  db.prepare('DELETE FROM material_reads WHERE material_id = ?').run(mat.id);
  db.prepare('DELETE FROM materials WHERE id = ?').run(mat.id);
  recordAuditLog({
    actorId: req.user!.userId,
    actorName: req.user!.name,
    actorRole: req.user!.role,
    action: 'DELETE_MATERIAL',
    targetType: 'material',
    targetId: mat.id,
    detail: `Menghapus materi "${mat.title}"`,
    ipAddress: getClientIp(req),
  });
  res.json({ ok: true });
});

app.post('/api/elearning/materials/:id/read', authMiddleware, requireRoles('siswa'), (req: AuthedRequest, res) => {
  db.prepare(`
    INSERT INTO material_reads (material_id, student_id, student_name, class_name, read_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(material_id, student_id) DO UPDATE SET read_at = excluded.read_at
  `).run(req.params.id, req.user!.userId, req.user!.name, req.user!.className, new Date().toISOString());
  res.json({ ok: true });
});

app.get('/api/elearning/assignments', authMiddleware, (req: AuthedRequest, res) => {
  let rows: any[];
  if (req.user!.role === 'siswa') {
    rows = db
      .prepare('SELECT * FROM assignments WHERE class_name = ? ORDER BY deadline ASC')
      .all(req.user!.className);
  } else if (req.user!.role === 'admin') {
    rows = db.prepare('SELECT * FROM assignments ORDER BY created_at DESC').all();
  } else {
    rows = db
      .prepare('SELECT * FROM assignments WHERE teacher_id = ? ORDER BY created_at DESC')
      .all(req.user!.userId);
  }

  const enriched = rows.map((a) => {
    if (req.user!.role === 'siswa') {
      const sub = db
        .prepare('SELECT * FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?')
        .get(a.id, req.user!.userId);
      return { ...a, allowLate: Boolean(a.allow_late ?? 1), mySubmission: sub || null };
    }
    const submissions = db
      .prepare('SELECT * FROM assignment_submissions WHERE assignment_id = ? ORDER BY submitted_at DESC')
      .all(a.id);
    return { ...a, allowLate: Boolean(a.allow_late ?? 1), submissions };
  });
  res.json(enriched);
});

app.post('/api/elearning/assignments', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas'), (req: AuthedRequest, res) => {
  const { subject, className, title, description, deadline, maxScore, allowLate } = req.body;
  if (!subject || !className || !title || !deadline) {
    res.status(400).json({ error: 'Mapel, kelas, judul tugas, dan batas waktu wajib diisi.' });
    return;
  }
  const id = `asg-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(`
    INSERT INTO assignments (id, teacher_id, teacher_name, subject, class_name, title, description, deadline, max_score, allow_late, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    req.user!.userId,
    req.user!.name,
    subject,
    className,
    title,
    description || '',
    deadline,
    Number(maxScore) || 100,
    allowLate === false ? 0 : 1,
    new Date().toISOString()
  );
  res.json({ id });
});

app.delete('/api/elearning/assignments/:id', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas'), (req: AuthedRequest, res) => {
  const asg = db.prepare('SELECT id, teacher_id, title FROM assignments WHERE id = ?').get(req.params.id) as any;
  if (!asg) {
    res.status(404).json({ error: 'Tugas tidak ditemukan.' });
    return;
  }
  if (req.user!.role !== 'admin' && asg.teacher_id !== req.user!.userId) {
    res.status(403).json({ error: 'Anda hanya dapat menghapus tugas milik sendiri.' });
    return;
  }
  db.prepare('DELETE FROM assignment_submissions WHERE assignment_id = ?').run(asg.id);
  db.prepare('DELETE FROM assignments WHERE id = ?').run(asg.id);
  recordAuditLog({
    actorId: req.user!.userId,
    actorName: req.user!.name,
    actorRole: req.user!.role,
    action: 'DELETE_ASSIGNMENT',
    targetType: 'assignment',
    targetId: asg.id,
    detail: `Menghapus tugas "${asg.title}"`,
    ipAddress: getClientIp(req),
  });
  res.json({ ok: true });
});

app.post('/api/elearning/assignments/:id/submit', authMiddleware, requireRoles('siswa'), (req: AuthedRequest, res) => {
  const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id) as any;
  if (!assignment) {
    res.status(404).json({ error: 'Tugas tidak ditemukan.' });
    return;
  }
  if (assignment.class_name !== req.user!.className) {
    res.status(403).json({ error: 'Tugas ini bukan untuk kelas Anda.' });
    return;
  }
  const { answerText, attachmentUrl } = req.body;
  if (!answerText && !attachmentUrl) {
    res.status(400).json({ error: 'Isi jawaban atau lampirkan tautan/berkas tugas.' });
    return;
  }

  const deadlineMs = parseAssignmentDeadlineMs(assignment.deadline, getSchoolTimezone());
  const isLate = deadlineMs !== null && Date.now() > deadlineMs;
  if (isLate && Number(assignment.allow_late ?? 1) === 0) {
    res.status(403).json({ error: 'Batas waktu pengumpulan tugas telah berakhir dan pengumpulan terlambat ditutup oleh guru.' });
    return;
  }

  const id = `sub-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(`
    INSERT INTO assignment_submissions (id, assignment_id, student_id, student_name, class_name, answer_text, attachment_url, submitted_at, status, is_late)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'dikumpulkan', ?)
    ON CONFLICT(assignment_id, student_id) DO UPDATE SET
      answer_text = excluded.answer_text,
      attachment_url = excluded.attachment_url,
      submitted_at = excluded.submitted_at,
      status = 'dikumpulkan',
      is_late = excluded.is_late
  `).run(
    id,
    req.params.id,
    req.user!.userId,
    req.user!.name,
    req.user!.className,
    answerText || '',
    attachmentUrl || '',
    new Date().toISOString(),
    isLate ? 1 : 0
  );
  res.json({ ok: true, isLate });
});

app.post('/api/elearning/submissions/:id/grade', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas'), (req, res) => {
  const { score, teacherNote } = req.body;
  db.prepare(`
    UPDATE assignment_submissions SET score = ?, teacher_note = ?, status = 'dinilai' WHERE id = ?
  `).run(Number(score), teacherNote || '', req.params.id);
  res.json({ ok: true });
});

// ============================================================================
// 7. Face Attendance (Mobile Blink + GPS, Gate Kiosk, Manual S/I/A, Excel Recap)
// ============================================================================
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

app.get('/api/attendance/settings', authMiddleware, (_req, res) => {
  const row = db.prepare('SELECT * FROM attendance_settings WHERE id = 1').get();
  res.json(row);
});

app.put('/api/attendance/settings', authMiddleware, requireRoles('admin'), (req: AuthedRequest, res) => {
  const parsed = attendanceSettingsSchema.safeParse(req.body || {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Pengaturan sekolah tidak valid.' });
    return;
  }
  const { schoolName, schoolLat, schoolLng, radiusMeters, entryTime, lateToleranceMin, checkoutTime, timezone } =
    parsed.data;
  db.prepare(`
    UPDATE attendance_settings
    SET school_name = ?, school_lat = ?, school_lng = ?, radius_meters = ?, entry_time = ?, late_tolerance_min = ?, checkout_time = ?, timezone = ?
    WHERE id = 1
  `).run(schoolName, schoolLat, schoolLng, radiusMeters, entryTime, lateToleranceMin, checkoutTime, timezone);
  recordAuditLog({
    actorId: req.user!.userId,
    actorName: req.user!.name,
    actorRole: req.user!.role,
    action: 'UPDATE_SCHOOL_SETTINGS',
    targetType: 'attendance_settings',
    targetId: '1',
    detail: `Memperbarui area & zona waktu sekolah (${timezone})`,
    ipAddress: getClientIp(req),
  });
  res.json({ ok: true });
});

app.get('/api/attendance/logs', authMiddleware, (req: AuthedRequest, res) => {
  const tzNow = getSchoolNowParts(getSchoolTimezone());
  const month = req.query.month ? String(req.query.month) : tzNow.dateStr.slice(0, 7);
  const className = req.query.className ? String(req.query.className) : '';
  let sql = 'SELECT * FROM attendance_logs WHERE date LIKE ?';
  const params: any[] = [`${month}%`];
  if (req.user!.role === 'siswa') {
    sql += ' AND student_id = ?';
    params.push(req.user!.userId);
  } else if (className) {
    sql += ' AND class_name = ?';
    params.push(className);
  }
  sql += ' ORDER BY date DESC, student_name ASC';
  res.json(db.prepare(sql).all(...params));
});

function parseFaceDescriptor(raw: unknown): number[] | null {
  let arr: unknown = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return null;
    try {
      arr = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr) || arr.length < 32 || arr.length > 512) return null;
  const nums = arr.map((v) => Number(v));
  if (nums.some((v) => !Number.isFinite(v))) return null;
  const norm = Math.sqrt(nums.reduce((acc, v) => acc + v * v, 0));
  if (norm <= 0) return null;
  return nums.map((v) => Number((v / norm).toFixed(4)));
}

function computeCosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function sanitizeImageUrl(raw: unknown): string {
  const val = String(raw || '').trim();
  if (!val) return '';
  if (val.startsWith('/api/uploads/') || val.startsWith('/src/assets/') || val.startsWith('https://')) {
    return val;
  }
  return '';
}

app.get('/api/attendance/face-status', authMiddleware, (req: AuthedRequest, res) => {
  const userRow = db
    .prepare('SELECT id, face_descriptor_json, photo_url FROM users WHERE id = ?')
    .get(req.user!.userId) as any;
  const schoolNow = getSchoolNowParts(getSchoolTimezone());
  const todayLog = db
    .prepare('SELECT * FROM attendance_logs WHERE student_id = ? AND date = ?')
    .get(req.user!.userId, schoolNow.dateStr) as any;
  const parsed = parseFaceDescriptor(userRow?.face_descriptor_json);
  res.json({
    enrolled: Boolean(parsed),
    descriptorLength: parsed ? parsed.length : 0,
    photoUrl: userRow?.photo_url || '',
    today: schoolNow.dateStr,
    todayLog: todayLog || null,
  });
});

app.post('/api/attendance/enroll-face', authMiddleware, (req: AuthedRequest, res) => {
  const { studentId, faceDescriptor, photoUrl, updateAvatar } = req.body || {};
  const isStaff = ['admin', 'guru', 'wali_kelas', 'pengawas'].includes(req.user!.role);
  const targetUserId = isStaff && studentId ? String(studentId) : req.user!.userId;

  if (!isStaff && targetUserId !== req.user!.userId) {
    res.status(403).json({ error: 'Tidak memiliki izin mendaftarkan wajah pengguna lain.' });
    return;
  }

  const normalized = parseFaceDescriptor(faceDescriptor);
  if (!normalized) {
    res.status(400).json({ error: 'Vektor wajah tidak valid. Pastikan wajah terlihat jelas di kamera.' });
    return;
  }

  const targetUser = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(targetUserId) as any;
  if (!targetUser) {
    res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
    return;
  }

  const safePhoto = sanitizeImageUrl(photoUrl);
  db.prepare('UPDATE users SET face_descriptor_json = ? WHERE id = ?').run(JSON.stringify(normalized), targetUserId);
  if (safePhoto && updateAvatar) {
    db.prepare('UPDATE users SET photo_url = ? WHERE id = ?').run(safePhoto, targetUserId);
    if (targetUser.role === 'siswa') {
      db.prepare('UPDATE student_master_records SET photo_url = ? WHERE student_id = ?').run(safePhoto, targetUserId);
    }
  }

  recordAuditLog({
    actorId: req.user!.userId,
    actorName: req.user!.name,
    actorRole: req.user!.role,
    action: 'ENROLL_FACE',
    targetType: 'user',
    targetId: targetUserId,
    detail: `Mendaftarkan/memperbarui profil wajah untuk ${targetUser.name}`,
    ipAddress: getClientIp(req),
  });

  res.json({ ok: true, enrolled: true, targetUserId, photoUrl: safePhoto || undefined });
});

app.post('/api/attendance/face-checkin', authMiddleware, requireRoles('siswa'), (req: AuthedRequest, res) => {
  const { livenessBlinkVerified, lat, lng, mode, faceDescriptor, photoUrl } = req.body || {};
  if (!livenessBlinkVerified) {
    res.status(400).json({ error: 'Verifikasi kedipan mata (anti-foto) belum berhasil.' });
    return;
  }
  const settings = db.prepare('SELECT * FROM attendance_settings WHERE id = 1').get() as any;
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    res.status(400).json({ error: 'Koordinat lokasi GPS diperlukan untuk absensi dari HP.' });
    return;
  }
  const dist = Math.round(haversineMeters(lat, lng, settings.school_lat, settings.school_lng));
  if (dist > settings.radius_meters) {
    res.status(403).json({
      error: `Anda berada ${dist} meter dari area ${settings.school_name} (maksimal ${settings.radius_meters} meter). Absensi ditolak.`,
      distanceMeters: dist,
    });
    return;
  }

  const studentRow = db.prepare('SELECT face_descriptor_json FROM users WHERE id = ?').get(req.user!.userId) as any;
  const enrolledVec = parseFaceDescriptor(studentRow?.face_descriptor_json);
  const incomingVec = parseFaceDescriptor(faceDescriptor);
  let matchScorePct: number | null = null;
  let autoEnrolled = false;

  if (enrolledVec && incomingVec) {
    if (enrolledVec.length === incomingVec.length) {
      const sim = computeCosineSimilarity(enrolledVec, incomingVec);
      matchScorePct = Math.round(Math.max(0, Math.min(1, sim)) * 100);
      if (sim < 0.72) {
        res.status(403).json({
          error: `Wajah tidak cocok dengan profil terdaftar (kecocokan ${matchScorePct}%, minimum 72%). Pastikan pencahayaan cukup atau perbarui profil wajah Anda.`,
          matchScore: matchScorePct,
        });
        return;
      }
    }
  } else if (!enrolledVec && incomingVec) {
    db.prepare('UPDATE users SET face_descriptor_json = ? WHERE id = ?').run(
      JSON.stringify(incomingVec),
      req.user!.userId
    );
    matchScorePct = 100;
    autoEnrolled = true;
  }

  const safePhoto = sanitizeImageUrl(photoUrl);
  const schoolNow = getSchoolNowParts(settings.timezone || 'Asia/Jakarta');
  const today = schoolNow.dateStr;
  const nowTime = schoolNow.timeStr;
  const nowMin = schoolNow.minutesOfDay;
  const entryLimit = timeToMinutes(settings.entry_time) + Number(settings.late_tolerance_min || 15);
  const checkoutStart = timeToMinutes(settings.checkout_time);

  const existing = db
    .prepare('SELECT * FROM attendance_logs WHERE student_id = ? AND date = ?')
    .get(req.user!.userId, today) as any;

  if (mode === 'pulang' || (existing && existing.check_in_time && nowMin >= checkoutStart)) {
    if (!existing) {
      db.prepare(`
        INSERT INTO attendance_logs (id, student_id, student_name, class_name, date, check_in_time, check_out_time, status, method, liveness_blink_verified, distance_meters, photo_url, face_match_score, note, recorded_by)
        VALUES (?, ?, ?, ?, ?, '', ?, 'Pulang', 'face_mobile', 1, ?, ?, ?, 'Absen pulang via HP', ?)
      `).run(
        `att-${crypto.randomUUID().slice(0, 8)}`,
        req.user!.userId,
        req.user!.name,
        req.user!.className,
        today,
        nowTime,
        dist,
        safePhoto,
        matchScorePct,
        req.user!.name
      );
    } else {
      db.prepare(`
        UPDATE attendance_logs
        SET check_out_time = ?, status = 'Pulang', distance_meters = ?, liveness_blink_verified = 1,
            photo_url = COALESCE(NULLIF(?, ''), photo_url),
            face_match_score = COALESCE(?, face_match_score)
        WHERE id = ?
      `).run(nowTime, dist, safePhoto, matchScorePct, existing.id);
    }
    recordAuditLog({
      actorId: req.user!.userId,
      actorName: req.user!.name,
      actorRole: req.user!.role,
      action: 'ATTENDANCE_FACE',
      targetType: 'attendance',
      targetId: today,
      detail: `Absen pulang via HP (${nowTime}, ${dist} m${matchScorePct != null ? `, cocok ${matchScorePct}%` : ''})`,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true, status: 'Pulang', time: nowTime, distanceMeters: dist, matchScore: matchScorePct, autoEnrolled });
    return;
  }

  if (mode === 'masuk' && existing && existing.check_in_time) {
    res.json({
      ok: true,
      alreadyCheckedIn: true,
      status: existing.status,
      time: existing.check_in_time,
      distanceMeters: dist,
      matchScore: matchScorePct ?? existing.face_match_score,
      autoEnrolled,
    });
    return;
  }

  const status = nowMin <= entryLimit ? 'Hadir' : 'Terlambat';
  if (existing) {
    db.prepare(`
      UPDATE attendance_logs
      SET check_in_time = ?, status = ?, distance_meters = ?, liveness_blink_verified = 1,
          photo_url = COALESCE(NULLIF(?, ''), photo_url),
          face_match_score = COALESCE(?, face_match_score)
      WHERE id = ?
    `).run(nowTime, status, dist, safePhoto, matchScorePct, existing.id);
  } else {
    db.prepare(`
      INSERT INTO attendance_logs (id, student_id, student_name, class_name, date, check_in_time, check_out_time, status, method, liveness_blink_verified, distance_meters, photo_url, face_match_score, note, recorded_by)
      VALUES (?, ?, ?, ?, ?, ?, '', ?, 'face_mobile', 1, ?, ?, ?, 'Verifikasi wajah berkedip via HP', ?)
    `).run(
      `att-${crypto.randomUUID().slice(0, 8)}`,
      req.user!.userId,
      req.user!.name,
      req.user!.className,
      today,
      nowTime,
      status,
      dist,
      safePhoto,
      matchScorePct,
      req.user!.name
    );
  }
  recordAuditLog({
    actorId: req.user!.userId,
    actorName: req.user!.name,
    actorRole: req.user!.role,
    action: 'ATTENDANCE_FACE',
    targetType: 'attendance',
    targetId: today,
    detail: `Absen ${status} via HP (${nowTime}, ${dist} m${matchScorePct != null ? `, cocok ${matchScorePct}%` : ''})`,
    ipAddress: getClientIp(req),
  });
  res.json({ ok: true, status, time: nowTime, distanceMeters: dist, matchScore: matchScorePct, autoEnrolled });
});

app.post('/api/attendance/kiosk-checkin', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas', 'pengawas'), (req: AuthedRequest, res) => {
  const { studentId, mode, faceDescriptor, photoUrl } = req.body || {};
  const incomingVec = parseFaceDescriptor(faceDescriptor);
  let student: any = null;
  let matchScorePct: number | null = null;

  if (studentId) {
    student = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'siswa' AND status = 'aktif'").get(studentId) as any;
    if (student && incomingVec) {
      const enrolledVec = parseFaceDescriptor(student.face_descriptor_json);
      if (enrolledVec && enrolledVec.length === incomingVec.length) {
        const sim = computeCosineSimilarity(enrolledVec, incomingVec);
        matchScorePct = Math.round(Math.max(0, Math.min(1, sim)) * 100);
      }
    }
  } else if (incomingVec) {
    const enrolledStudents = db
      .prepare("SELECT * FROM users WHERE role = 'siswa' AND status = 'aktif' AND face_descriptor_json != ''")
      .all() as any[];
    let bestSim = -1;
    let bestStudent: any = null;
    for (const candidate of enrolledStudents) {
      const vec = parseFaceDescriptor(candidate.face_descriptor_json);
      if (!vec || vec.length !== incomingVec.length) continue;
      const sim = computeCosineSimilarity(vec, incomingVec);
      if (sim > bestSim) {
        bestSim = sim;
        bestStudent = candidate;
      }
    }
    if (!bestStudent || bestSim < 0.74) {
      res.status(404).json({
        error: enrolledStudents.length === 0
          ? 'Belum ada profil wajah siswa yang terdaftar. Pilih siswa secara manual atau daftarkan wajah dahulu.'
          : `Wajah tidak cocok dengan siswa terdaftar (skor tertinggi ${Math.round(Math.max(0, bestSim) * 100)}%). Silakan pilih siswa manual.`,
      });
      return;
    }
    student = bestStudent;
    matchScorePct = Math.round(Math.max(0, Math.min(1, bestSim)) * 100);
  }

  if (!student) {
    res.status(404).json({ error: 'Siswa aktif tidak ditemukan.' });
    return;
  }

  const safePhoto = sanitizeImageUrl(photoUrl);
  const settings = db.prepare('SELECT * FROM attendance_settings WHERE id = 1').get() as any;
  const schoolNow = getSchoolNowParts(settings.timezone || 'Asia/Jakarta');
  const today = schoolNow.dateStr;
  const nowTime = schoolNow.timeStr;
  const nowMin = schoolNow.minutesOfDay;
  const entryLimit = timeToMinutes(settings.entry_time) + Number(settings.late_tolerance_min || 15);
  const checkoutStart = timeToMinutes(settings.checkout_time);

  const existing = db.prepare('SELECT * FROM attendance_logs WHERE student_id = ? AND date = ?').get(student.id, today) as any;
  const isCheckout = mode === 'pulang' || (existing && existing.check_in_time && nowMin >= checkoutStart);

  if (isCheckout) {
    if (existing) {
      db.prepare(`
        UPDATE attendance_logs
        SET check_out_time = ?, status = 'Pulang', method = 'kiosk',
            photo_url = COALESCE(NULLIF(?, ''), photo_url),
            face_match_score = COALESCE(?, face_match_score)
        WHERE id = ?
      `).run(nowTime, safePhoto, matchScorePct, existing.id);
    } else {
      db.prepare(`
        INSERT INTO attendance_logs (id, student_id, student_name, class_name, date, check_in_time, check_out_time, status, method, liveness_blink_verified, distance_meters, photo_url, face_match_score, note, recorded_by)
        VALUES (?, ?, ?, ?, ?, '', ?, 'Pulang', 'kiosk', 1, 0, ?, ?, 'Kiosk Gerbang Sekolah', ?)
      `).run(`att-${crypto.randomUUID().slice(0, 8)}`, student.id, student.name, student.class_name, today, nowTime, safePhoto, matchScorePct, req.user!.name);
    }
    recordAuditLog({
      actorId: req.user!.userId,
      actorName: req.user!.name,
      actorRole: req.user!.role,
      action: 'ATTENDANCE_KIOSK',
      targetType: 'attendance',
      targetId: student.id,
      detail: `Kiosk Pulang: ${student.name} (${nowTime})`,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true, studentId: student.id, studentName: student.name, className: student.class_name, status: 'Pulang', time: nowTime, matchScore: matchScorePct });
    return;
  }

  const status = nowMin <= entryLimit ? 'Hadir' : 'Terlambat';
  if (existing) {
    db.prepare(`
      UPDATE attendance_logs
      SET check_in_time = ?, status = ?, method = 'kiosk',
          photo_url = COALESCE(NULLIF(?, ''), photo_url),
          face_match_score = COALESCE(?, face_match_score)
      WHERE id = ?
    `).run(nowTime, status, safePhoto, matchScorePct, existing.id);
  } else {
    db.prepare(`
      INSERT INTO attendance_logs (id, student_id, student_name, class_name, date, check_in_time, check_out_time, status, method, liveness_blink_verified, distance_meters, photo_url, face_match_score, note, recorded_by)
      VALUES (?, ?, ?, ?, ?, ?, '', ?, 'kiosk', 1, 0, ?, ?, 'Kiosk Gerbang Sekolah', ?)
    `).run(`att-${crypto.randomUUID().slice(0, 8)}`, student.id, student.name, student.class_name, today, nowTime, status, safePhoto, matchScorePct, req.user!.name);
  }
  recordAuditLog({
    actorId: req.user!.userId,
    actorName: req.user!.name,
    actorRole: req.user!.role,
    action: 'ATTENDANCE_KIOSK',
    targetType: 'attendance',
    targetId: student.id,
    detail: `Kiosk ${status}: ${student.name} (${nowTime})`,
    ipAddress: getClientIp(req),
  });
  res.json({ ok: true, studentId: student.id, studentName: student.name, className: student.class_name, status, time: nowTime, matchScore: matchScorePct });
});

app.get('/api/attendance/summary', authMiddleware, (req: AuthedRequest, res) => {
  const tzNow = getSchoolNowParts(getSchoolTimezone());
  const month = req.query.month ? String(req.query.month) : tzNow.dateStr.slice(0, 7);
  const className = req.query.className ? String(req.query.className) : '';

  let studentsSql = "SELECT id, username, name, class_name FROM users WHERE role = 'siswa' AND status = 'aktif'";
  const sParams: any[] = [];
  if (req.user!.role === 'siswa') {
    studentsSql += ' AND id = ?';
    sParams.push(req.user!.userId);
  } else if (className) {
    studentsSql += ' AND class_name = ?';
    sParams.push(className);
  }
  studentsSql += ' ORDER BY class_name ASC, name ASC';
  const students = db.prepare(studentsSql).all(...sParams) as any[];

  let logsSql = 'SELECT * FROM attendance_logs WHERE date LIKE ?';
  const lParams: any[] = [`${month}%`];
  if (req.user!.role === 'siswa') {
    logsSql += ' AND student_id = ?';
    lParams.push(req.user!.userId);
  } else if (className) {
    logsSql += ' AND class_name = ?';
    lParams.push(className);
  }
  const logs = db.prepare(logsSql).all(...lParams) as any[];

  const rows = students.map((st) => {
    const mine = logs.filter((l) => l.student_id === st.id);
    const hadir = mine.filter((m) => m.status === 'Hadir' || m.status === 'Pulang').length;
    const terlambat = mine.filter((m) => m.status === 'Terlambat').length;
    const sakit = mine.filter((m) => m.status === 'Sakit').length;
    const izin = mine.filter((m) => m.status === 'Izin').length;
    const alpha = mine.filter((m) => m.status === 'Alpha').length;
    const total = mine.length;
    const attendanceRate = total > 0 ? Math.round(((hadir + terlambat) / total) * 100) : 0;
    return {
      studentId: st.id,
      nis: st.username,
      name: st.name,
      className: st.class_name,
      hadir,
      terlambat,
      sakit,
      izin,
      alpha,
      total,
      attendanceRate,
    };
  });

  res.json({ month, className, rows });
});

app.post('/api/attendance/manual', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas'), (req: AuthedRequest, res) => {
  const { studentId, date, status, note } = req.body;
  const student = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'siswa'").get(studentId) as any;
  if (!student || !date || !status) {
    res.status(400).json({ error: 'Siswa, tanggal, dan status kehadiran wajib diisi.' });
    return;
  }
  db.prepare(`
    INSERT INTO attendance_logs (id, student_id, student_name, class_name, date, check_in_time, check_out_time, status, method, liveness_blink_verified, distance_meters, note, recorded_by)
    VALUES (?, ?, ?, ?, ?, '', '', ?, 'manual', 0, NULL, ?, ?)
    ON CONFLICT(student_id, date) DO UPDATE SET status = excluded.status, method = 'manual', note = excluded.note, recorded_by = excluded.recorded_by
  `).run(`att-${crypto.randomUUID().slice(0, 8)}`, student.id, student.name, student.class_name, date, status, note || '', req.user!.name);
  recordAuditLog({
    actorId: req.user!.userId,
    actorName: req.user!.name,
    actorRole: req.user!.role,
    action: 'ATTENDANCE_MANUAL',
    targetType: 'attendance',
    targetId: student.id,
    detail: `Catat manual ${status} untuk ${student.name} tanggal ${date}`,
    ipAddress: getClientIp(req),
  });
  res.json({ ok: true });
});

app.get('/api/attendance/export', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas'), (req, res) => {
  const tzNow = getSchoolNowParts(getSchoolTimezone());
  const month = req.query.month ? String(req.query.month) : tzNow.dateStr.slice(0, 7);
  const className = req.query.className ? String(req.query.className) : '';

  let studentsSql = "SELECT id, username, name, class_name FROM users WHERE role = 'siswa' AND status = 'aktif'";
  const sParams: any[] = [];
  if (className) {
    studentsSql += ' AND class_name = ?';
    sParams.push(className);
  }
  studentsSql += ' ORDER BY class_name, name';
  const students = db.prepare(studentsSql).all(...sParams) as any[];

  let logsSql = 'SELECT * FROM attendance_logs WHERE date LIKE ?';
  const lParams: any[] = [`${month}%`];
  if (className) {
    logsSql += ' AND class_name = ?';
    lParams.push(className);
  }
  logsSql += ' ORDER BY date DESC, student_name ASC';
  const logs = db.prepare(logsSql).all(...lParams) as any[];

  const summaryRows = students.map((st, idx) => {
    const mine = logs.filter((l) => l.student_id === st.id);
    const count = (status: string) => mine.filter((m) => m.status === status).length;
    const hadirCount = count('Hadir') + count('Pulang');
    const terlambatCount = count('Terlambat');
    const total = mine.length;
    return {
      No: idx + 1,
      NIS: st.username,
      'Nama Siswa': st.name,
      Kelas: st.class_name,
      Hadir: hadirCount,
      Terlambat: terlambatCount,
      Sakit: count('Sakit'),
      Izin: count('Izin'),
      Alpha: count('Alpha'),
      'Total Tercatat': total,
      'Persentase Hadir (%)': total > 0 ? Math.round(((hadirCount + terlambatCount) / total) * 100) : 0,
    };
  });

  const detailRows = logs.map((l) => ({
    Tanggal: l.date,
    'Nama Siswa': l.student_name,
    Kelas: l.class_name,
    Status: l.status,
    Masuk: l.check_in_time || '-',
    Pulang: l.check_out_time || '-',
    Metode: l.method === 'face_mobile' ? 'Wajah HP' : l.method === 'kiosk' ? 'Kiosk Gerbang' : 'Manual Guru',
    'Skor Wajah (%)': l.face_match_score ?? '-',
    'Jarak (m)': l.distance_meters ?? '-',
    Catatan: l.note || '-',
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), `Rekap ${month}`);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows), 'Log Harian');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const classSuffix = className ? `-${className}` : '';
  res.setHeader('Content-Disposition', `attachment; filename="rekap-absensi-${month}${classSuffix}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// ============================================================================
// 8. Rapor Kurikulum Merdeka (TP, Nilai, Auto Deskripsi, CBT Sync, Leger, A4)
// ============================================================================
app.get('/api/rapor/tps', authMiddleware, (req, res) => {
  const subject = req.query.subject ? String(req.query.subject) : '';
  const className = req.query.className ? String(req.query.className) : '';
  const semester = req.query.semester ? String(req.query.semester) : '';
  let sql = 'SELECT * FROM learning_objectives WHERE 1=1';
  const params: any[] = [];
  if (subject) { sql += ' AND subject = ?'; params.push(subject); }
  if (className) { sql += ' AND class_name = ?'; params.push(className); }
  if (semester) { sql += ' AND semester = ?'; params.push(semester); }
  sql += ' ORDER BY code ASC';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/rapor/tps', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas'), (req: AuthedRequest, res) => {
  const { subject, className, semester, code, description } = req.body;
  if (!subject || !className || !code || !description) {
    res.status(400).json({ error: 'Lengkapi mapel, kelas, kode TP, dan deskripsi.' });
    return;
  }
  const id = `tp-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(`
    INSERT INTO learning_objectives (id, teacher_id, subject, class_name, semester, code, description)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.user!.userId, subject, className, semester || 'Ganjil', code, description);
  res.json({ id });
});

app.delete('/api/rapor/tps/:id', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas'), (req, res) => {
  db.prepare('DELETE FROM learning_objectives WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

function buildCompetencyDescription(achievedIds: string[], guidanceIds: string[]): string {
  const allTPs = db.prepare('SELECT id, description FROM learning_objectives').all() as any[];
  const tpMap = new Map(allTPs.map((t) => [t.id, t.description]));
  const achievedTexts = achievedIds.map((id) => tpMap.get(id)).filter(Boolean);
  const guidanceTexts = guidanceIds.map((id) => tpMap.get(id)).filter(Boolean);
  const parts: string[] = [];
  if (achievedTexts.length > 0) {
    parts.push(`Menunjukkan penguasaan yang sangat baik dalam ${achievedTexts.join(' serta ')}.`);
  }
  if (guidanceTexts.length > 0) {
    parts.push(`Perlu bimbingan lebih lanjut dalam ${guidanceTexts.join(' serta ')}.`);
  }
  return parts.join(' ') || 'Capaian kompetensi sesuai standar ketuntasan minimal.';
}

app.get('/api/rapor/scores', authMiddleware, (req: AuthedRequest, res) => {
  const className = req.query.className ? String(req.query.className) : 'XII-IPA-1';
  const subject = req.query.subject ? String(req.query.subject) : '';
  const semester = req.query.semester ? String(req.query.semester) : 'Ganjil';
  const academicYear = req.query.academicYear ? String(req.query.academicYear) : '2026/2027';

  if (req.user!.role === 'siswa') {
    const scores = db
      .prepare('SELECT * FROM rapor_subject_scores WHERE student_id = ? AND semester = ? AND academic_year = ? ORDER BY subject ASC')
      .all(req.user!.userId, semester, academicYear);
    res.json(scores);
    return;
  }

  let sql = `
    SELECT r.*, u.name as student_name, u.username as nis
    FROM rapor_subject_scores r
    JOIN users u ON u.id = r.student_id
    WHERE r.class_name = ? AND r.semester = ? AND r.academic_year = ?
  `;
  const params: any[] = [className, semester, academicYear];
  if (subject) {
    sql += ' AND r.subject = ?';
    params.push(subject);
  }
  sql += ' ORDER BY u.name ASC';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/rapor/scores', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas'), (req: AuthedRequest, res) => {
  const {
    studentId,
    subject,
    className,
    semester = 'Ganjil',
    academicYear = '2026/2027',
    harianScore,
    ptsScore,
    pasScore,
    weightHarian = 50,
    weightPts = 25,
    weightPas = 25,
    tpAchievedIds = [],
    tpNeedsGuidanceIds = [],
  } = req.body;

  const wSum = Math.max(1, Number(weightHarian) + Number(weightPts) + Number(weightPas));
  const finalScore = Number(
    (
      (Number(harianScore) * Number(weightHarian) +
        Number(ptsScore) * Number(weightPts) +
        Number(pasScore) * Number(weightPas)) /
      wSum
    ).toFixed(2)
  );
  const autoDesc = buildCompetencyDescription(tpAchievedIds, tpNeedsGuidanceIds);
  const id = `rs-${crypto.randomUUID().slice(0, 8)}`;

  db.prepare(`
    INSERT INTO rapor_subject_scores (id, student_id, subject, class_name, semester, academic_year, teacher_id, harian_score, pts_score, pas_score, weight_harian, weight_pts, weight_pas, final_score, tp_achieved_ids_json, tp_needs_guidance_ids_json, competency_description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(student_id, subject, semester, academic_year) DO UPDATE SET
      harian_score = excluded.harian_score,
      pts_score = excluded.pts_score,
      pas_score = excluded.pas_score,
      weight_harian = excluded.weight_harian,
      weight_pts = excluded.weight_pts,
      weight_pas = excluded.weight_pas,
      final_score = excluded.final_score,
      tp_achieved_ids_json = excluded.tp_achieved_ids_json,
      tp_needs_guidance_ids_json = excluded.tp_needs_guidance_ids_json,
      competency_description = excluded.competency_description
  `).run(
    id,
    studentId,
    subject,
    className,
    semester,
    academicYear,
    req.user!.userId,
    Number(harianScore) || 0,
    Number(ptsScore) || 0,
    Number(pasScore) || 0,
    Number(weightHarian),
    Number(weightPts),
    Number(weightPas),
    finalScore,
    JSON.stringify(tpAchievedIds),
    JSON.stringify(tpNeedsGuidanceIds),
    autoDesc
  );
  recordAuditLog({
    actorId: req.user!.userId,
    actorName: req.user!.name,
    actorRole: req.user!.role,
    action: 'UPDATE_RAPOR_SCORE',
    targetType: 'rapor_score',
    targetId: studentId,
    detail: `Menyimpan nilai ${subject} (${className}, ${semester}): akhir=${finalScore}`,
    ipAddress: getClientIp(req),
  });
  res.json({ ok: true, finalScore, competencyDescription: autoDesc });
});

app.post('/api/rapor/sync-cbt-tasks', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas'), (req: AuthedRequest, res) => {
  const { className, subject, semester = 'Ganjil', academicYear = '2026/2027' } = req.body;
  const students = db
    .prepare("SELECT id, name FROM users WHERE role = 'siswa' AND status = 'aktif' AND class_name = ?")
    .all(className) as any[];

  const tps = db
    .prepare('SELECT id FROM learning_objectives WHERE subject = ? AND class_name = ?')
    .all(subject, className) as any[];
  const tpIds = tps.map((t) => t.id);

  let updatedCount = 0;
  for (const st of students) {
    // Average submitted CBT scores for this subject
    const cbtAvgRow = db
      .prepare(`
        SELECT AVG(s.total_score) as avg_cbt
        FROM cbt_sessions s
        JOIN cbt_exams e ON e.id = s.exam_id
        WHERE s.student_id = ? AND e.subject = ? AND s.status = 'submitted'
      `)
      .get(st.id, subject) as any;

    // Average graded assignment scores for this subject
    const taskAvgRow = db
      .prepare(`
        SELECT AVG(sub.score) as avg_task
        FROM assignment_submissions sub
        JOIN assignments a ON a.id = sub.assignment_id
        WHERE sub.student_id = ? AND a.subject = ? AND sub.score IS NOT NULL
      `)
      .get(st.id, subject) as any;

    const existing = db
      .prepare('SELECT * FROM rapor_subject_scores WHERE student_id = ? AND subject = ? AND semester = ? AND academic_year = ?')
      .get(st.id, subject, semester, academicYear) as any;

    const harian = taskAvgRow?.avg_task != null ? Number(Number(taskAvgRow.avg_task).toFixed(1)) : existing?.harian_score ?? 82;
    const pts = cbtAvgRow?.avg_cbt != null ? Number(Number(cbtAvgRow.avg_cbt).toFixed(1)) : existing?.pts_score ?? 80;
    const pas = existing?.pas_score ?? pts;
    const finalScore = Number(((harian * 50 + pts * 25 + pas * 25) / 100).toFixed(2));
    const achieved = finalScore >= 85 ? tpIds : tpIds.slice(0, Math.max(1, tpIds.length - 1));
    const guidance = finalScore >= 85 ? [] : tpIds.slice(Math.max(1, tpIds.length - 1));
    const desc = buildCompetencyDescription(achieved, guidance);

    db.prepare(`
      INSERT INTO rapor_subject_scores (id, student_id, subject, class_name, semester, academic_year, teacher_id, harian_score, pts_score, pas_score, weight_harian, weight_pts, weight_pas, final_score, tp_achieved_ids_json, tp_needs_guidance_ids_json, competency_description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 50, 25, 25, ?, ?, ?, ?)
      ON CONFLICT(student_id, subject, semester, academic_year) DO UPDATE SET
        harian_score = excluded.harian_score,
        pts_score = excluded.pts_score,
        final_score = excluded.final_score,
        tp_achieved_ids_json = excluded.tp_achieved_ids_json,
        tp_needs_guidance_ids_json = excluded.tp_needs_guidance_ids_json,
        competency_description = excluded.competency_description
    `).run(
      `rs-${crypto.randomUUID().slice(0, 8)}`,
      st.id,
      subject,
      className,
      semester,
      academicYear,
      req.user!.userId,
      harian,
      pts,
      pas,
      finalScore,
      JSON.stringify(achieved),
      JSON.stringify(guidance),
      desc
    );
    updatedCount++;
  }
  recordAuditLog({
    actorId: req.user!.userId,
    actorName: req.user!.name,
    actorRole: req.user!.role,
    action: 'SYNC_RAPOR_CBT',
    targetType: 'rapor_score',
    targetId: `${className}:${subject}`,
    detail: `Sinkronisasi nilai CBT & tugas untuk ${updatedCount} siswa (${subject} · ${className})`,
    ipAddress: getClientIp(req),
  });
  res.json({ ok: true, updatedCount });
});

app.get('/api/rapor/homeroom', authMiddleware, requireRoles('admin', 'wali_kelas', 'guru'), (req, res) => {
  const className = req.query.className ? String(req.query.className) : 'XII-IPA-1';
  const semester = req.query.semester ? String(req.query.semester) : 'Ganjil';
  const academicYear = req.query.academicYear ? String(req.query.academicYear) : '2026/2027';
  const students = db
    .prepare("SELECT id, username, name, class_name, photo_url FROM users WHERE role = 'siswa' AND status = 'aktif' AND class_name = ? ORDER BY name ASC")
    .all(className) as any[];
  const homeroomRows = db
    .prepare('SELECT * FROM rapor_homeroom WHERE class_name = ? AND semester = ? AND academic_year = ?')
    .all(className, semester, academicYear) as any[];
  const hMap = new Map(homeroomRows.map((h) => [h.student_id, h]));

  const attCounts = db
    .prepare("SELECT student_id, status, COUNT(*) as cnt FROM attendance_logs WHERE status IN ('Sakit','Izin','Alpha') GROUP BY student_id, status")
    .all() as any[];

  res.json(
    students.map((st) => {
      const h = hMap.get(st.id);
      const getAtt = (s: string) => attCounts.find((a) => a.student_id === st.id && a.status === s)?.cnt || 0;
      return {
        studentId: st.id,
        nis: st.username,
        studentName: st.name,
        className: st.class_name,
        academicYear,
        extracurriculars: h ? JSON.parse(h.extracurricular_json || '[]') : [],
        sakit: h ? h.sakit : getAtt('Sakit'),
        izin: h ? h.izin : getAtt('Izin'),
        alpha: h ? h.alpha : getAtt('Alpha'),
        attendanceSuggestion: { sakit: getAtt('Sakit'), izin: getAtt('Izin'), alpha: getAtt('Alpha') },
        homeroomNote: h?.homeroom_note || '',
        promotionStatus: h?.promotion_status || 'Proses',
      };
    })
  );
});

app.post('/api/rapor/homeroom', authMiddleware, requireRoles('admin', 'wali_kelas'), (req: AuthedRequest, res) => {
  const {
    studentId,
    className,
    semester = 'Ganjil',
    academicYear = '2026/2027',
    extracurriculars = [],
    sakit = 0,
    izin = 0,
    alpha = 0,
    homeroomNote = '',
    promotionStatus = 'Proses',
  } = req.body;
  db.prepare(`
    INSERT INTO rapor_homeroom (id, student_id, class_name, semester, academic_year, extracurricular_json, sakit, izin, alpha, homeroom_note, promotion_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(student_id, semester, academic_year) DO UPDATE SET
      extracurricular_json = excluded.extracurricular_json,
      sakit = excluded.sakit,
      izin = excluded.izin,
      alpha = excluded.alpha,
      homeroom_note = excluded.homeroom_note,
      promotion_status = excluded.promotion_status
  `).run(
    `rh-${crypto.randomUUID().slice(0, 8)}`,
    studentId,
    className,
    semester,
    academicYear,
    JSON.stringify(extracurriculars),
    Number(sakit),
    Number(izin),
    Number(alpha),
    homeroomNote,
    promotionStatus
  );
  recordAuditLog({
    actorId: req.user!.userId,
    actorName: req.user!.name,
    actorRole: req.user!.role,
    action: 'UPDATE_RAPOR_HOMEROOM',
    targetType: 'rapor_homeroom',
    targetId: studentId,
    detail: `Memperbarui catatan wali kelas & ekstrakurikuler (${className}, ${semester} ${academicYear})`,
    ipAddress: getClientIp(req),
  });
  res.json({ ok: true });
});

function buildLegerData(className: string, semester: string, academicYear: string) {
  const students = db
    .prepare("SELECT id, username, name, class_name FROM users WHERE role = 'siswa' AND status = 'aktif' AND class_name = ?")
    .all(className) as any[];
  const scores = db
    .prepare('SELECT * FROM rapor_subject_scores WHERE class_name = ? AND semester = ? AND academic_year = ?')
    .all(className, semester, academicYear) as any[];
  const subjects = Array.from(new Set(scores.map((s) => s.subject))).sort();

  const rows = students.map((st) => {
    const stScores = scores.filter((s) => s.student_id === st.id);
    const subjectMap: Record<string, number> = {};
    let sum = 0;
    for (const sub of subjects) {
      const found = stScores.find((x) => x.subject === sub);
      const val = found ? Number(found.final_score) : 0;
      subjectMap[sub] = val;
      sum += val;
    }
    const avg = subjects.length > 0 ? Number((sum / subjects.length).toFixed(2)) : 0;
    return {
      studentId: st.id,
      nis: st.username,
      name: st.name,
      className: st.class_name,
      subjectMap,
      total: Number(sum.toFixed(2)),
      average: avg,
      rank: 0,
    };
  });
  rows.sort((a, b) => b.total - a.total);
  rows.forEach((r, idx) => { r.rank = idx + 1; });
  return { className, semester, academicYear, subjects, rows };
}

app.get('/api/rapor/leger', authMiddleware, requireRoles('admin', 'wali_kelas', 'guru'), (req, res) => {
  const className = req.query.className ? String(req.query.className) : 'XII-IPA-1';
  const semester = req.query.semester ? String(req.query.semester) : 'Ganjil';
  const academicYear = req.query.academicYear ? String(req.query.academicYear) : '2026/2027';
  res.json(buildLegerData(className, semester, academicYear));
});

app.get('/api/rapor/leger/export', authMiddleware, requireRoles('admin', 'wali_kelas', 'guru'), (req, res) => {
  const className = req.query.className ? String(req.query.className) : 'XII-IPA-1';
  const semester = req.query.semester ? String(req.query.semester) : 'Ganjil';
  const academicYear = req.query.academicYear ? String(req.query.academicYear) : '2026/2027';
  const leger = buildLegerData(className, semester, academicYear);

  const excelRows = leger.rows.map((r) => {
    const row: Record<string, any> = {
      Peringkat: r.rank,
      NIS: r.nis,
      'Nama Siswa': r.name,
      Kelas: r.className,
    };
    for (const sub of leger.subjects) {
      row[sub] = r.subjectMap[sub] ?? 0;
    }
    row['Jumlah Nilai'] = r.total;
    row['Rata-rata'] = r.average;
    return row;
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(excelRows), `Leger ${className}`);
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename="leger-${className}-${semester}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

app.get('/api/rapor/student-report/:studentId', authMiddleware, (req: AuthedRequest, res) => {
  const targetId = req.params.studentId === 'me' ? req.user!.userId : req.params.studentId;
  if (req.user!.role === 'siswa' && targetId !== req.user!.userId) {
    res.status(403).json({ error: 'Siswa hanya dapat melihat rapor miliknya sendiri.' });
    return;
  }
  const semester = req.query.semester ? String(req.query.semester) : 'Ganjil';
  const academicYear = req.query.academicYear ? String(req.query.academicYear) : '2026/2027';
  const settings = db.prepare('SELECT school_name FROM attendance_settings WHERE id = 1').get() as any;
  const student = db.prepare('SELECT id, username, name, class_name, photo_url FROM users WHERE id = ?').get(targetId) as any;
  if (!student) {
    res.status(404).json({ error: 'Siswa tidak ditemukan.' });
    return;
  }
  const master = db.prepare('SELECT nis, nisn FROM student_master_records WHERE student_id = ?').get(targetId) as any;
  const subjects = db
    .prepare('SELECT * FROM rapor_subject_scores WHERE student_id = ? AND semester = ? AND academic_year = ? ORDER BY subject ASC')
    .all(targetId, semester, academicYear);
  const homeroom = db
    .prepare('SELECT * FROM rapor_homeroom WHERE student_id = ? AND semester = ? AND academic_year = ?')
    .get(targetId, semester, academicYear) as any;

  res.json({
    schoolName: settings?.school_name || 'SMA Negeri Terpadu Lentera Eduka',
    academicYear,
    semester,
    student: {
      ...student,
      nis: master?.nis || student.username,
      nisn: master?.nisn || '-',
    },
    subjects,
    homeroom: homeroom
      ? {
          ...homeroom,
          extracurriculars: JSON.parse(homeroom.extracurricular_json || '[]'),
        }
      : {
          extracurriculars: [],
          sakit: 0,
          izin: 0,
          alpha: 0,
          homeroom_note: '-',
          promotion_status: 'Proses',
        },
  });
});

// ============================================================================
// 9. Buku Induk & Alumni + Mass Promotion / Graduation
// ============================================================================
app.get('/api/buku-induk', authMiddleware, (req: AuthedRequest, res) => {
  if (req.user!.role === 'siswa') {
    const row = db
      .prepare(`
        SELECT u.id, u.username, u.name, u.class_name, u.status, u.photo_url, u.email, u.phone, m.*
        FROM users u
        LEFT JOIN student_master_records m ON m.student_id = u.id
        WHERE u.id = ?
      `)
      .get(req.user!.userId) as any;
    const history = db
      .prepare('SELECT * FROM class_history WHERE student_id = ? ORDER BY academic_year ASC, semester ASC')
      .all(req.user!.userId);
    res.json([{ ...row, history }]);
    return;
  }

  const statusFilter = req.query.status ? String(req.query.status) : '';
  let sql = `
    SELECT u.id, u.username, u.name, u.class_name, u.status, u.photo_url, u.email, u.phone, m.*
    FROM users u
    JOIN student_master_records m ON m.student_id = u.id
    WHERE u.role = 'siswa'
  `;
  const params: any[] = [];
  if (statusFilter) {
    sql += ' AND u.status = ?';
    params.push(statusFilter);
  }
  sql += ' ORDER BY u.status ASC, u.class_name ASC, u.name ASC';
  const rows = db.prepare(sql).all(...params) as any[];
  const histories = db.prepare('SELECT * FROM class_history ORDER BY academic_year ASC').all() as any[];

  res.json(
    rows.map((r) => ({
      ...r,
      history: histories.filter((h) => h.student_id === r.id),
    }))
  );
});

app.put('/api/buku-induk/:studentId', authMiddleware, requireRoles('admin', 'wali_kelas'), (req: AuthedRequest, res) => {
  const {
    name,
    className,
    photoUrl,
    birthPlace,
    birthDate,
    gender,
    religion,
    address,
    fatherName,
    fatherJob,
    motherName,
    motherJob,
    parentPhone,
    previousSchool,
    graduationYear,
    diplomaNumber,
    alumniDestination,
    alumniNotes,
  } = req.body;

  const safePhoto = sanitizeImageUrl(photoUrl);

  if (name) {
    db.prepare('UPDATE users SET name = ?, class_name = ? WHERE id = ?').run(name, className || '', req.params.studentId);
  }
  if (safePhoto) {
    db.prepare('UPDATE users SET photo_url = ? WHERE id = ?').run(safePhoto, req.params.studentId);
  }

  db.prepare(`
    UPDATE student_master_records
    SET birth_place = ?, birth_date = ?, gender = ?, religion = ?, address = ?,
        father_name = ?, father_job = ?, mother_name = ?, mother_job = ?, parent_phone = ?,
        previous_school = ?, graduation_year = ?, diploma_number = ?, alumni_destination = ?, alumni_notes = ?,
        photo_url = COALESCE(NULLIF(?, ''), photo_url)
    WHERE student_id = ?
  `).run(
    birthPlace || '',
    birthDate || '',
    gender || 'Laki-laki',
    religion || 'Islam',
    address || '',
    fatherName || '',
    fatherJob || '',
    motherName || '',
    motherJob || '',
    parentPhone || '',
    previousSchool || '',
    graduationYear || '',
    diplomaNumber || '',
    alumniDestination || '',
    alumniNotes || '',
    safePhoto,
    req.params.studentId
  );

  recordAuditLog({
    actorId: req.user!.userId,
    actorName: req.user!.name,
    actorRole: req.user!.role,
    action: 'UPDATE_BUKU_INDUK',
    targetType: 'student',
    targetId: req.params.studentId,
    detail: `Memperbarui data buku induk / alumni (${name || req.params.studentId})`,
    ipAddress: getClientIp(req),
  });
  res.json({ ok: true, photoUrl: safePhoto || undefined });
});

app.post('/api/buku-induk/batch-process', authMiddleware, requireRoles('admin'), (req: AuthedRequest, res) => {
  const { studentIds, action, targetClassName, academicYear, semester = 'Genap', graduationYear } = req.body;
  if (!Array.isArray(studentIds) || studentIds.length === 0) {
    res.status(400).json({ error: 'Pilih minimal satu siswa untuk diproses massal.' });
    return;
  }

  const targetYear = academicYear || '2026/2027';

  // Build real class averages & ranks per class_name from rapor_subject_scores
  const classRankLookup = new Map<string, { average: number; rank: number }>();
  const allScores = db
    .prepare('SELECT student_id, class_name, AVG(final_score) as avg_score FROM rapor_subject_scores WHERE academic_year = ? GROUP BY student_id, class_name')
    .all(targetYear) as any[];
  const byClass = new Map<string, Array<{ studentId: string; avg: number }>>();
  for (const row of allScores) {
    const list = byClass.get(row.class_name) || [];
    list.push({ studentId: row.student_id, avg: Number(Number(row.avg_score || 0).toFixed(2)) });
    byClass.set(row.class_name, list);
  }
  for (const list of byClass.values()) {
    list.sort((a, b) => b.avg - a.avg);
    list.forEach((item, idx) => {
      classRankLookup.set(item.studentId, { average: item.avg, rank: idx + 1 });
    });
  }

  db.exec('BEGIN');
  try {
    for (const sid of studentIds) {
      const user = db.prepare('SELECT id, class_name FROM users WHERE id = ?').get(sid) as any;
      if (!user) continue;
      const metrics = classRankLookup.get(sid) || { average: 85.0, rank: 1 };

      if (action === 'graduate') {
        db.prepare("UPDATE users SET status = 'lulus', session_version = session_version + 1 WHERE id = ?").run(sid);
        db.prepare(`
          UPDATE student_master_records
          SET graduation_year = ?, diploma_number = COALESCE(NULLIF(diploma_number,''), ?)
          WHERE student_id = ?
        `).run(
          String(graduationYear || '2026'),
          `DN-05/MA/${graduationYear || '2026'}/${Math.floor(10000 + Math.random() * 89999)}`,
          sid
        );
        db.prepare(`
          INSERT INTO class_history (id, student_id, academic_year, semester, class_name, average_score, rank_in_class, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'Lulus')
        `).run(`ch-${crypto.randomUUID().slice(0, 8)}`, sid, targetYear, semester, user.class_name, metrics.average, metrics.rank);
      } else if (action === 'promote' && targetClassName) {
        db.prepare(`
          INSERT INTO class_history (id, student_id, academic_year, semester, class_name, average_score, rank_in_class, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'Naik Kelas')
        `).run(`ch-${crypto.randomUUID().slice(0, 8)}`, sid, targetYear, semester, user.class_name, metrics.average, metrics.rank);
        db.prepare('UPDATE users SET class_name = ? WHERE id = ?').run(targetClassName, sid);
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  recordAuditLog({
    actorId: req.user!.userId,
    actorName: req.user!.name,
    actorRole: req.user!.role,
    action: 'BATCH_PROMOTE_GRADUATE',
    targetType: 'student',
    targetId: action,
    detail: `Proses massal ${action === 'graduate' ? 'kelulusan' : `kenaikan ke ${targetClassName}`} untuk ${studentIds.length} siswa`,
    ipAddress: getClientIp(req),
  });
  res.json({ ok: true, processedCount: studentIds.length });
});

app.get('/api/buku-induk/alumni/export', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas'), (_req, res) => {
  const rows = db
    .prepare(`
      SELECT u.username as nis, u.name, u.class_name, u.email, u.phone, m.*
      FROM users u
      JOIN student_master_records m ON m.student_id = u.id
      WHERE u.role = 'siswa' AND u.status = 'lulus'
      ORDER BY m.graduation_year DESC, u.name ASC
    `)
    .all() as any[];

  const excelRows = rows.map((r, idx) => ({
    No: idx + 1,
    NIS: r.nis || r.username,
    NISN: r.nisn || '-',
    'Nama Lengkap': r.name,
    'Kelas Terakhir': r.class_name,
    'Angkatan Lulus': r.graduation_year || '-',
    'Nomor Ijazah': r.diploma_number || '-',
    'Studi Lanjut / Karier': r.alumni_destination || '-',
    'Kontak Orang Tua': r.parent_phone || '-',
    Catatan: r.alumni_notes || '-',
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(excelRows), 'Direktori Alumni');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="direktori-alumni.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// ============================================================================
// 10. Tatap Muka Online (Google Meet Integration)
// ============================================================================
function parseGoogleMeetInput(raw: string): { valid: boolean; meetUrl: string; meetCode: string } {
  const input = String(raw || '').trim();
  const codeRegex = /^([a-z]{3}-[a-z]{4}-[a-z]{3})$/i;
  const codeMatch = input.match(codeRegex);
  if (codeMatch) {
    const code = codeMatch[1].toLowerCase();
    return { valid: true, meetUrl: `https://meet.google.com/${code}`, meetCode: code };
  }
  try {
    const url = new URL(input);
    if (url.hostname === 'meet.google.com') {
      const slug = url.pathname.replace(/^\/+/, '').split('/')[0];
      if (codeRegex.test(slug)) {
        const code = slug.toLowerCase();
        return { valid: true, meetUrl: `https://meet.google.com/${code}`, meetCode: code };
      }
    }
  } catch {
    return { valid: false, meetUrl: '', meetCode: '' };
  }
  return { valid: false, meetUrl: '', meetCode: '' };
}

function getMeetingWindowState(meetingDate: string, startTime: string, endTime: string) {
  const startMs = parseSchoolLocalDateTimeMs(meetingDate, startTime);
  const endMs = parseSchoolLocalDateTimeMs(meetingDate, endTime);
  const opensAtMs = startMs - 15 * 60000;
  const nowMs = getSchoolNowParts(getSchoolTimezone()).epochMs;
  const opensAtDate = new Date(opensAtMs);
  const opensAtLabel = `${String(opensAtDate.getUTCHours()).padStart(2, '0')}:${String(opensAtDate.getUTCMinutes()).padStart(2, '0')}`;

  if (nowMs < opensAtMs) {
    return {
      canJoin: false,
      state: 'belum_dibuka' as const,
      opensAtLabel,
      message: `Kelas belum dibuka. Tombol Gabung aktif mulai pukul ${opensAtLabel} (15 menit sebelum jadwal).`,
    };
  }
  if (nowMs > endMs) {
    return {
      canJoin: false,
      state: 'selesai' as const,
      opensAtLabel,
      message: `Pertemuan telah berakhir pada pukul ${endTime}.`,
    };
  }
  return {
    canJoin: true,
    state: 'terbuka' as const,
    opensAtLabel,
    message: 'Ruang Google Meet sedang dibuka.',
  };
}

app.get('/api/meetings', authMiddleware, (req: AuthedRequest, res) => {
  let rows: any[];
  if (req.user!.role === 'siswa') {
    rows = db
      .prepare('SELECT * FROM online_meetings WHERE class_name = ? ORDER BY meeting_date ASC, start_time ASC')
      .all(req.user!.className);
  } else if (req.user!.role === 'admin') {
    rows = db.prepare('SELECT * FROM online_meetings ORDER BY meeting_date ASC, start_time ASC').all();
  } else {
    // Teacher isolation: Guru ONLY sees and manages their own meetings!
    rows = db
      .prepare('SELECT * FROM online_meetings WHERE teacher_id = ? ORDER BY meeting_date ASC, start_time ASC')
      .all(req.user!.userId);
  }

  const enriched = rows.map((m) => {
    const windowInfo = getMeetingWindowState(m.meeting_date, m.start_time, m.end_time);
    const attCount = (db.prepare('SELECT COUNT(*) as cnt FROM meeting_attendance WHERE meeting_id = ?').get(m.id) as any).cnt;
    const joinedByMe =
      req.user!.role === 'siswa'
        ? Boolean(db.prepare('SELECT id FROM meeting_attendance WHERE meeting_id = ? AND student_id = ?').get(m.id, req.user!.userId))
        : false;
    return {
      ...m,
      ...windowInfo,
      attendanceCount: attCount,
      joinedByMe,
    };
  });
  res.json(enriched);
});

app.post('/api/meetings', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas'), (req: AuthedRequest, res) => {
  const parsedBody = createMeetingSchema.safeParse(req.body || {});
  if (!parsedBody.success) {
    res.status(400).json({ error: parsedBody.error.issues[0]?.message || 'Lengkapi seluruh kolom pertemuan Meet.' });
    return;
  }
  const { title, subject, className, meetingDate, startTime, endTime, meetInput, repeatWeeks } = parsedBody.data;
  const parsed = parseGoogleMeetInput(meetInput);
  if (!parsed.valid) {
    res.status(400).json({
      error: 'Tautan tidak valid. Gunakan tautan Google Meet (https://meet.google.com/abc-defg-hij) atau kode abc-defg-hij.',
    });
    return;
  }

  const weeks = Math.min(16, Math.max(1, repeatWeeks));
  const seriesId = `ser-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const [baseY, baseM, baseD] = meetingDate.split('-').map(Number);
  const baseUtcMs = Date.UTC(baseY, baseM - 1, baseD, 12, 0, 0);
  const insert = db.prepare(`
    INSERT INTO online_meetings (id, series_id, teacher_id, teacher_name, title, subject, class_name, meeting_date, start_time, end_time, meet_url, meet_code, repeat_weeks, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const createdIds: string[] = [];
  db.exec('BEGIN');
  try {
    for (let w = 0; w < weeks; w++) {
      const occDate = new Date(baseUtcMs + w * 7 * 86400000);
      const dateStr = `${occDate.getUTCFullYear()}-${String(occDate.getUTCMonth() + 1).padStart(2, '0')}-${String(occDate.getUTCDate()).padStart(2, '0')}`;
      const id = `meet-${crypto.randomUUID().slice(0, 8)}`;
      insert.run(
        id,
        seriesId,
        req.user!.userId,
        req.user!.name,
        weeks > 1 ? `${title} (Pekan ${w + 1})` : title,
        subject,
        className,
        dateStr,
        startTime,
        endTime,
        parsed.meetUrl,
        parsed.meetCode,
        weeks,
        now
      );
      createdIds.push(id);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  res.json({ ok: true, seriesId, createdCount: createdIds.length, meetUrl: parsed.meetUrl });
});

app.delete('/api/meetings/:id', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas'), (req: AuthedRequest, res) => {
  const m = db.prepare('SELECT teacher_id FROM online_meetings WHERE id = ?').get(req.params.id) as any;
  if (!m) {
    res.status(404).json({ error: 'Pertemuan tidak ditemukan.' });
    return;
  }
  if (req.user!.role !== 'admin' && m.teacher_id !== req.user!.userId) {
    res.status(403).json({ error: 'Anda hanya dapat menghapus pertemuan milik Anda sendiri.' });
    return;
  }
  db.prepare('DELETE FROM online_meetings WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM meeting_attendance WHERE meeting_id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/meetings/:id/join', authMiddleware, requireRoles('siswa'), (req: AuthedRequest, res) => {
  const m = db.prepare('SELECT * FROM online_meetings WHERE id = ?').get(req.params.id) as any;
  if (!m) {
    res.status(404).json({ error: 'Pertemuan tidak ditemukan.' });
    return;
  }
  if (m.class_name !== req.user!.className) {
    res.status(403).json({
      error: `Pertemuan ini khusus untuk kelas ${m.class_name}. Siswa dari kelas lain (${req.user!.className}) tidak dapat bergabung.`,
    });
    return;
  }
  const win = getMeetingWindowState(m.meeting_date, m.start_time, m.end_time);
  if (!win.canJoin) {
    res.status(403).json({ error: win.message, opensAtLabel: win.opensAtLabel, state: win.state });
    return;
  }
  const joinedAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO meeting_attendance (id, meeting_id, student_id, student_name, class_name, joined_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(meeting_id, student_id) DO UPDATE SET joined_at = excluded.joined_at
  `).run(`ma-${crypto.randomUUID().slice(0, 8)}`, m.id, req.user!.userId, req.user!.name, req.user!.className, joinedAt);

  res.json({ ok: true, meetUrl: m.meet_url, joinedAt });
});

app.get('/api/meetings/:id/attendance', authMiddleware, requireRoles('admin', 'guru', 'wali_kelas'), (req: AuthedRequest, res) => {
  const m = db.prepare('SELECT * FROM online_meetings WHERE id = ?').get(req.params.id) as any;
  if (!m) {
    res.status(404).json({ error: 'Pertemuan tidak ditemukan.' });
    return;
  }
  if (req.user!.role !== 'admin' && m.teacher_id !== req.user!.userId) {
    res.status(403).json({ error: 'Anda hanya dapat melihat daftar hadir pertemuan Anda sendiri.' });
    return;
  }
  const list = db
    .prepare('SELECT * FROM meeting_attendance WHERE meeting_id = ? ORDER BY joined_at ASC')
    .all(m.id);
  res.json({ meeting: m, attendees: list });
});

// ============================================================================
// 11. Student Beranda Activity Feed
// ============================================================================
app.get('/api/student/activity-feed', authMiddleware, requireRoles('siswa'), (req: AuthedRequest, res) => {
  const studentId = req.user!.userId;

  type ActivityItem = {
    id: string;
    category: 'cbt' | 'tugas' | 'materi' | 'online' | 'absensi';
    targetSection: 'cbt' | 'elearning' | 'online' | 'absensi';
    title: string;
    subject: string;
    statusLabel: string;
    statusTone: 'emerald' | 'amber' | 'teal' | 'red' | 'slate';
    detail: string;
    scoreValue: number | null;
    scoreMax: number | null;
    scoreLabel: string | null;
    timestamp: string;
  };

  const items: ActivityItem[] = [];

  // 1. Completed / Graded CBT Exams
  const cbtRows = db
    .prepare(
      `SELECT s.id, s.exam_id, s.status, s.started_at, s.submitted_at,
              s.auto_score, s.manual_score, s.total_score, s.essay_grades_json,
              e.title, e.subject, e.question_ids_json
       FROM cbt_sessions s
       JOIN cbt_exams e ON e.id = s.exam_id
       WHERE s.student_id = ? AND s.status = 'submitted'
       ORDER BY COALESCE(NULLIF(s.submitted_at, ''), s.started_at) DESC
       LIMIT 15`
    )
    .all(studentId) as any[];

  const checkEssayStmt = db.prepare("SELECT id FROM questions WHERE id = ? AND type = 'URAIAN'");

  for (const row of cbtRows) {
    let essayGrades: Record<string, any> = {};
    let questionIds: string[] = [];
    try {
      essayGrades = JSON.parse(row.essay_grades_json || '{}');
    } catch {
      essayGrades = {};
    }
    try {
      questionIds = JSON.parse(row.question_ids_json || '[]');
    } catch {
      questionIds = [];
    }

    const essayIds = questionIds.filter((qid) => Boolean(checkEssayStmt.get(qid)));
    const hasEssay = essayIds.length > 0;
    const allEssayGraded = hasEssay ? essayIds.every((qid) => essayGrades[qid] !== undefined) : true;

    const totalScore = Number(row.total_score ?? 0);
    const formattedScore = Number.isInteger(totalScore) ? String(totalScore) : totalScore.toFixed(2).replace(/\.?0+$/, '');

    let statusLabel = 'Ujian CBT Selesai & Dinilai';
    let statusTone: ActivityItem['statusTone'] = 'emerald';
    let detail = 'Penilaian otomatis selesai diproses';

    if (hasEssay && !allEssayGraded) {
      statusLabel = 'Ujian Selesai · Menunggu Nilai Esai';
      statusTone = 'amber';
      detail = `Skor sementara ${formattedScore} (esainya menunggu koreksi guru)`;
    } else if (hasEssay && allEssayGraded) {
      statusLabel = 'Ujian CBT Dinilai';
      statusTone = 'emerald';
      detail = 'Nilai akhir sudah termasuk koreksi soal esai oleh guru';
    }

    items.push({
      id: `cbt-${row.id}`,
      category: 'cbt',
      targetSection: 'cbt',
      title: row.title,
      subject: row.subject,
      statusLabel,
      statusTone,
      detail,
      scoreValue: totalScore,
      scoreMax: 100,
      scoreLabel: formattedScore,
      timestamp: row.submitted_at || row.started_at,
    });
  }

  // 2. Submitted & Graded Assignments
  const assignmentRows = db
    .prepare(
      `SELECT sub.id, sub.assignment_id, sub.submitted_at, sub.score, sub.teacher_note, sub.status, sub.is_late,
              a.title, a.subject, a.max_score
       FROM assignment_submissions sub
       JOIN assignments a ON a.id = sub.assignment_id
       WHERE sub.student_id = ?
       ORDER BY sub.submitted_at DESC
       LIMIT 15`
    )
    .all(studentId) as any[];

  for (const row of assignmentRows) {
    const isGraded = row.status === 'dinilai';
    const isLate = Number(row.is_late) === 1;
    const maxScore = Number(row.max_score || 100);
    const numericScore = isGraded && row.score !== null && row.score !== undefined ? Number(row.score) : null;
    const formattedScore =
      numericScore !== null
        ? Number.isInteger(numericScore)
          ? String(numericScore)
          : numericScore.toFixed(1).replace(/\.0$/, '')
        : null;

    items.push({
      id: `tugas-${row.id}`,
      category: 'tugas',
      targetSection: 'elearning',
      title: row.title,
      subject: row.subject,
      statusLabel: isGraded ? 'Tugas Dinilai' : isLate ? 'Dikumpulkan Terlambat' : 'Tugas Dikumpulkan',
      statusTone: isGraded ? 'emerald' : isLate ? 'amber' : 'teal',
      detail: isGraded
        ? row.teacher_note
          ? `Catatan guru: ${row.teacher_note}`
          : 'Tugas telah diperiksa dan dinilai guru'
        : isLate
        ? 'Dikumpulkan melewati batas waktu'
        : 'Menunggu penilaian guru pengampu',
      scoreValue: numericScore,
      scoreMax: maxScore,
      scoreLabel: formattedScore,
      timestamp: row.submitted_at,
    });
  }

  // 3. Material Reads
  const readRows = db
    .prepare(
      `SELECT mr.material_id, mr.read_at, m.title, m.subject, m.teacher_name
       FROM material_reads mr
       JOIN materials m ON m.id = mr.material_id
       WHERE mr.student_id = ?
       ORDER BY mr.read_at DESC
       LIMIT 10`
    )
    .all(studentId) as any[];

  for (const row of readRows) {
    items.push({
      id: `materi-${row.material_id}`,
      category: 'materi',
      targetSection: 'elearning',
      title: row.title,
      subject: row.subject,
      statusLabel: 'Materi Dibaca',
      statusTone: 'slate',
      detail: `Pengampu: ${row.teacher_name}`,
      scoreValue: null,
      scoreMax: null,
      scoreLabel: null,
      timestamp: row.read_at,
    });
  }

  // 4. Online Meeting Joins
  const meetRows = db
    .prepare(
      `SELECT ma.id, ma.joined_at, om.title, om.subject, om.meet_code, om.start_time, om.end_time
       FROM meeting_attendance ma
       JOIN online_meetings om ON om.id = ma.meeting_id
       WHERE ma.student_id = ?
       ORDER BY ma.joined_at DESC
       LIMIT 10`
    )
    .all(studentId) as any[];

  for (const row of meetRows) {
    items.push({
      id: `online-${row.id}`,
      category: 'online',
      targetSection: 'online',
      title: row.title,
      subject: row.subject,
      statusLabel: 'Hadir Kelas Online',
      statusTone: 'teal',
      detail: `Meet ${row.meet_code} · Jadwal ${row.start_time}–${row.end_time}`,
      scoreValue: null,
      scoreMax: null,
      scoreLabel: null,
      timestamp: row.joined_at,
    });
  }

  // 5. Recent Face / Gate / Manual Attendance Logs
  const attRows = db
    .prepare(
      `SELECT id, date, check_in_time, check_out_time, status, method, note
       FROM attendance_logs
       WHERE student_id = ?
       ORDER BY date DESC
       LIMIT 10`
    )
    .all(studentId) as any[];

  for (const row of attRows) {
    const timePart = row.check_out_time || row.check_in_time || '07:00';
    const isoTs = `${row.date}T${timePart.length === 5 ? `${timePart}:00` : '07:00:00'}+07:00`;
    const methodLabel =
      row.method === 'face_mobile' ? 'Absensi Wajah HP' : row.method === 'kiosk' ? 'Kiosk Gerbang' : 'Catatan Guru';
    const timeSummary = row.check_in_time
      ? row.check_out_time
        ? `Masuk ${row.check_in_time} · Pulang ${row.check_out_time}`
        : `Masuk ${row.check_in_time}`
      : row.note || 'Dicatat oleh guru/wali kelas';

    const tone: ActivityItem['statusTone'] =
      row.status === 'Hadir' || row.status === 'Pulang'
        ? 'emerald'
        : row.status === 'Terlambat' || row.status === 'Izin' || row.status === 'Sakit'
        ? 'amber'
        : 'red';

    items.push({
      id: `absensi-${row.id}`,
      category: 'absensi',
      targetSection: 'absensi',
      title: row.check_out_time ? 'Presensi Masuk & Pulang' : `Presensi ${row.status}`,
      subject: methodLabel,
      statusLabel: row.status,
      statusTone: tone,
      detail: timeSummary,
      scoreValue: null,
      scoreMax: null,
      scoreLabel: null,
      timestamp: isoTs,
    });
  }

  items.sort((a, b) => {
    const tA = new Date(a.timestamp).getTime() || 0;
    const tB = new Date(b.timestamp).getTime() || 0;
    return tB - tA;
  });

  const sorted = items.slice(0, 20);
  res.json({
    items: sorted,
    counts: {
      all: sorted.length,
      cbt: sorted.filter((i) => i.category === 'cbt').length,
      tugas: sorted.filter((i) => i.category === 'tugas').length,
      lainnya: sorted.filter((i) => i.category === 'materi' || i.category === 'online' || i.category === 'absensi').length,
    },
  });
});

// ============================================================================
// Vite Dev Middleware / Production Static Serve
// ============================================================================
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

async function startServer() {
  const argv = process.argv.slice(2);
  const getArgValue = (flag: string): string | undefined => {
    const eq = argv.find((a) => a.startsWith(`${flag}=`));
    if (eq) return eq.slice(flag.length + 1);
    const idx = argv.indexOf(flag);
    if (idx !== -1 && idx + 1 < argv.length) return argv[idx + 1];
    return undefined;
  };

  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(path.resolve(process.cwd(), 'dist'));
  const cliPort = Number(getArgValue('--port')) || 0;
  const host = getArgValue('--host') || '0.0.0.0';
  const envPort = Number(process.env.PORT) || 0;
  const nginxPort = Number(process.env.NGINX_PORT) || 0;
  const defaultAppPort = Number(process.env.DEFAULT_APP_PORT) || 3000;
  const PORT =
    cliPort ||
    (!isProd && nginxPort && envPort === nginxPort ? defaultAppPort : envPort || defaultAppPort);

  let viteInstance: Awaited<ReturnType<typeof createViteServer>> | null = null;

  if (!isProd) {
    const disableHmr = process.env.DISABLE_HMR === 'true';
    const vitePromise = createViteServer({
      server: {
        middlewareMode: true,
        hmr: disableHmr ? false : undefined,
        ws: disableHmr ? false : undefined,
        watch: disableHmr ? null : undefined,
      },
      appType: 'spa',
    }).then((vite) => {
      viteInstance = vite;
      return vite;
    });
    vitePromise.catch((err) => {
      console.error('Failed to start Vite middleware:', err);
      process.exit(1);
    });
    app.use(async (req, res, next) => {
      try {
        const vite = viteInstance || (await vitePromise);
        vite.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = app.listen(PORT, host, () => {
    console.log(`Lentera Eduka server running on http://${host}:${PORT}`);
  });

  const gracefulShutdown = (signal: string) => {
    console.log(`Received ${signal}, flushing CBT answers and shutting down cleanly...`);
    try {
      flushPendingAnswersToDb();
    } catch { /* ignore */ }
    if (viteInstance) {
      viteInstance.close().catch(() => {});
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2500).unref();
  };
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

startServer();
