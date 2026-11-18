import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'lentera.db');
export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA busy_timeout = 8000;
  PRAGMA foreign_keys = ON;
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    class_name TEXT DEFAULT '',
    homeroom_class TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'aktif',
    photo_url TEXT DEFAULT '',
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    session_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS login_slides (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    subtitle TEXT NOT NULL,
    tag TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL,
    accent_color TEXT NOT NULL DEFAULT '#0F766E',
    sort_order INTEGER NOT NULL DEFAULT 1,
    is_active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS ai_provider_keys (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    model_name TEXT NOT NULL DEFAULT '',
    encrypted_key TEXT NOT NULL,
    iv TEXT NOT NULL,
    auth_tag TEXT NOT NULL,
    masked_key TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(owner_id, provider)
  );

  CREATE TABLE IF NOT EXISTS teacher_assignments (
    id TEXT PRIMARY KEY,
    teacher_id TEXT NOT NULL,
    teacher_name TEXT NOT NULL,
    subject TEXT NOT NULL,
    class_name TEXT NOT NULL,
    academic_year TEXT NOT NULL DEFAULT '2026/2027'
  );

  CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    class_name TEXT NOT NULL,
    day_name TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    subject TEXT NOT NULL,
    teacher_id TEXT NOT NULL,
    teacher_name TEXT NOT NULL,
    room TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS question_banks (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    owner_name TEXT NOT NULL,
    subject TEXT NOT NULL,
    grade_level TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    bank_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    type TEXT NOT NULL,
    prompt TEXT NOT NULL,
    options_json TEXT NOT NULL,
    answer_key_json TEXT NOT NULL,
    points REAL NOT NULL DEFAULT 10,
    explanation TEXT DEFAULT '',
    difficulty_target TEXT DEFAULT 'Sedang',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cbt_exams (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    owner_name TEXT NOT NULL,
    title TEXT NOT NULL,
    subject TEXT NOT NULL,
    class_names_json TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 60,
    max_violations INTEGER NOT NULL DEFAULT 3,
    require_fullscreen INTEGER NOT NULL DEFAULT 1,
    shuffle_questions INTEGER NOT NULL DEFAULT 0,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    question_ids_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cbt_sessions (
    id TEXT PRIMARY KEY,
    exam_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    student_name TEXT NOT NULL,
    class_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'in_progress',
    violations_count INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    submitted_at TEXT DEFAULT '',
    auto_score REAL NOT NULL DEFAULT 0,
    manual_score REAL NOT NULL DEFAULT 0,
    total_score REAL NOT NULL DEFAULT 0,
    answers_json TEXT NOT NULL DEFAULT '{}',
    essay_grades_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE(exam_id, student_id)
  );

  CREATE TABLE IF NOT EXISTS cbt_violations (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    exam_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    student_name TEXT NOT NULL,
    type TEXT NOT NULL,
    detail TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS materials (
    id TEXT PRIMARY KEY,
    teacher_id TEXT NOT NULL,
    teacher_name TEXT NOT NULL,
    subject TEXT NOT NULL,
    class_name TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    blocks_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS material_reads (
    material_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    student_name TEXT NOT NULL,
    class_name TEXT NOT NULL,
    read_at TEXT NOT NULL,
    PRIMARY KEY(material_id, student_id)
  );

  CREATE TABLE IF NOT EXISTS assignments (
    id TEXT PRIMARY KEY,
    teacher_id TEXT NOT NULL,
    teacher_name TEXT NOT NULL,
    subject TEXT NOT NULL,
    class_name TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    deadline TEXT NOT NULL,
    max_score REAL NOT NULL DEFAULT 100,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS assignment_submissions (
    id TEXT PRIMARY KEY,
    assignment_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    student_name TEXT NOT NULL,
    class_name TEXT NOT NULL,
    answer_text TEXT NOT NULL DEFAULT '',
    attachment_url TEXT NOT NULL DEFAULT '',
    submitted_at TEXT NOT NULL,
    score REAL DEFAULT NULL,
    teacher_note TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'dikumpulkan',
    UNIQUE(assignment_id, student_id)
  );

  CREATE TABLE IF NOT EXISTS attendance_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    school_name TEXT NOT NULL,
    school_lat REAL NOT NULL,
    school_lng REAL NOT NULL,
    radius_meters INTEGER NOT NULL DEFAULT 150,
    entry_time TEXT NOT NULL DEFAULT '07:00',
    late_tolerance_min INTEGER NOT NULL DEFAULT 15,
    checkout_time TEXT NOT NULL DEFAULT '15:00',
    timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta'
  );

  CREATE TABLE IF NOT EXISTS attendance_logs (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL,
    student_name TEXT NOT NULL,
    class_name TEXT NOT NULL,
    date TEXT NOT NULL,
    check_in_time TEXT DEFAULT '',
    check_out_time TEXT DEFAULT '',
    status TEXT NOT NULL,
    method TEXT NOT NULL,
    liveness_blink_verified INTEGER NOT NULL DEFAULT 0,
    distance_meters REAL DEFAULT NULL,
    note TEXT DEFAULT '',
    recorded_by TEXT DEFAULT '',
    UNIQUE(student_id, date)
  );

  CREATE TABLE IF NOT EXISTS learning_objectives (
    id TEXT PRIMARY KEY,
    teacher_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    class_name TEXT NOT NULL,
    semester TEXT NOT NULL DEFAULT 'Ganjil',
    code TEXT NOT NULL,
    description TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rapor_subject_scores (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    class_name TEXT NOT NULL,
    semester TEXT NOT NULL DEFAULT 'Ganjil',
    academic_year TEXT NOT NULL DEFAULT '2026/2027',
    teacher_id TEXT NOT NULL,
    harian_score REAL NOT NULL DEFAULT 0,
    pts_score REAL NOT NULL DEFAULT 0,
    pas_score REAL NOT NULL DEFAULT 0,
    weight_harian INTEGER NOT NULL DEFAULT 50,
    weight_pts INTEGER NOT NULL DEFAULT 25,
    weight_pas INTEGER NOT NULL DEFAULT 25,
    final_score REAL NOT NULL DEFAULT 0,
    tp_achieved_ids_json TEXT NOT NULL DEFAULT '[]',
    tp_needs_guidance_ids_json TEXT NOT NULL DEFAULT '[]',
    competency_description TEXT NOT NULL DEFAULT '',
    UNIQUE(student_id, subject, semester, academic_year)
  );

  CREATE TABLE IF NOT EXISTS rapor_homeroom (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL,
    class_name TEXT NOT NULL,
    semester TEXT NOT NULL DEFAULT 'Ganjil',
    academic_year TEXT NOT NULL DEFAULT '2026/2027',
    extracurricular_json TEXT NOT NULL DEFAULT '[]',
    sakit INTEGER NOT NULL DEFAULT 0,
    izin INTEGER NOT NULL DEFAULT 0,
    alpha INTEGER NOT NULL DEFAULT 0,
    homeroom_note TEXT NOT NULL DEFAULT '',
    promotion_status TEXT NOT NULL DEFAULT 'Proses',
    UNIQUE(student_id, semester, academic_year)
  );

  CREATE TABLE IF NOT EXISTS student_master_records (
    student_id TEXT PRIMARY KEY,
    nis TEXT NOT NULL,
    nisn TEXT NOT NULL,
    birth_place TEXT NOT NULL DEFAULT 'Surabaya',
    birth_date TEXT NOT NULL DEFAULT '2009-05-14',
    gender TEXT NOT NULL DEFAULT 'Laki-laki',
    religion TEXT NOT NULL DEFAULT 'Islam',
    address TEXT NOT NULL DEFAULT '',
    father_name TEXT NOT NULL DEFAULT '',
    father_job TEXT NOT NULL DEFAULT '',
    mother_name TEXT NOT NULL DEFAULT '',
    mother_job TEXT NOT NULL DEFAULT '',
    parent_phone TEXT NOT NULL DEFAULT '',
    entry_year TEXT NOT NULL DEFAULT '2024',
    previous_school TEXT NOT NULL DEFAULT '',
    photo_url TEXT NOT NULL DEFAULT '',
    graduation_year TEXT DEFAULT '',
    diploma_number TEXT DEFAULT '',
    alumni_destination TEXT DEFAULT '',
    alumni_notes TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS class_history (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL,
    academic_year TEXT NOT NULL,
    semester TEXT NOT NULL,
    class_name TEXT NOT NULL,
    average_score REAL NOT NULL,
    rank_in_class INTEGER NOT NULL,
    status TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS online_meetings (
    id TEXT PRIMARY KEY,
    series_id TEXT NOT NULL,
    teacher_id TEXT NOT NULL,
    teacher_name TEXT NOT NULL,
    title TEXT NOT NULL,
    subject TEXT NOT NULL,
    class_name TEXT NOT NULL,
    meeting_date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    meet_url TEXT NOT NULL,
    meet_code TEXT NOT NULL,
    repeat_weeks INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meeting_attendance (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    student_name TEXT NOT NULL,
    class_name TEXT NOT NULL,
    joined_at TEXT NOT NULL,
    UNIQUE(meeting_id, student_id)
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT '',
    target_id TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '',
    ip_address TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS uploads (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    original_name TEXT NOT NULL,
    stored_name TEXT UNIQUE NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
`);

function ensureColumn(table: string, column: string, definition: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('users', 'session_version', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('users', 'face_descriptor_json', "TEXT NOT NULL DEFAULT ''");
ensureColumn('cbt_sessions', 'device_session_id', "TEXT NOT NULL DEFAULT ''");
ensureColumn('attendance_settings', 'timezone', "TEXT NOT NULL DEFAULT 'Asia/Jakarta'");
ensureColumn('attendance_logs', 'photo_url', "TEXT NOT NULL DEFAULT ''");
ensureColumn('attendance_logs', 'face_match_score', 'REAL DEFAULT NULL');
ensureColumn('assignments', 'allow_late', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('assignment_submissions', 'is_late', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('cbt_exams', 'shuffle_options', 'INTEGER NOT NULL DEFAULT 0');

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_users_role_status ON users(role, status, class_name);
  CREATE INDEX IF NOT EXISTS idx_cbt_sessions_exam_status ON cbt_sessions(exam_id, status);
  CREATE INDEX IF NOT EXISTS idx_cbt_violations_exam_time ON cbt_violations(exam_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_attendance_date_class ON attendance_logs(date, class_name);
  CREATE INDEX IF NOT EXISTS idx_rapor_class_sem ON rapor_subject_scores(class_name, semester);
  CREATE INDEX IF NOT EXISTS idx_meetings_class_date ON online_meetings(class_name, meeting_date);
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
`);

export function recordAuditLog(params: {
  actorId: string;
  actorName: string;
  actorRole: string;
  action: string;
  targetType?: string;
  targetId?: string;
  detail?: string;
  ipAddress?: string;
}): void {
  try {
    db.prepare(`
      INSERT INTO audit_logs (id, actor_id, actor_name, actor_role, action, target_type, target_id, detail, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `aud-${crypto.randomUUID().slice(0, 10)}`,
      params.actorId,
      params.actorName,
      params.actorRole,
      params.action,
      params.targetType || '',
      params.targetId || '',
      params.detail || '',
      params.ipAddress || '',
      new Date().toISOString()
    );
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function getLocalDateStr(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value || '00';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

function getTimeOffsetStr(offsetMinutes: number): string {
  const d = new Date(Date.now() + offsetMinutes * 60000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value || '00';
  return `${String(Number(g('hour')) % 24).padStart(2, '0')}:${g('minute')}`;
}

export function seedDatabaseIfEmpty(): void {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
  if (row.cnt > 0) return;

  const now = new Date().toISOString();
  const hashAdmin = bcrypt.hashSync('admin123', 8);
  const hashGuru = bcrypt.hashSync('guru123', 8);
  const hashPengawas = bcrypt.hashSync('pengawas123', 8);
  const hashWali = bcrypt.hashSync('wali123', 8);
  const hashSiswa = bcrypt.hashSync('siswa123', 8);

  const insertUser = db.prepare(`
    INSERT INTO users (id, username, password_hash, name, role, class_name, homeroom_class, status, photo_url, email, phone, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const malePhoto = '/src/assets/images/avatar_student_male_1794936325167.jpg';
  const femalePhoto = '/src/assets/images/avatar_student_female_1794936324549.jpg';

  insertUser.run('u-admin', 'admin', hashAdmin, 'Drs. Hendra Wijaya, M.M.', 'admin', '', '', 'aktif', malePhoto, 'hendra.wijaya@lenteraeduka.sch.id', '081234567001', now);
  insertUser.run('u-guru1', 'guru1', hashGuru, 'Siti Rahmawati, M.Pd.', 'guru', '', '', 'aktif', femalePhoto, 'siti.rahmawati@lenteraeduka.sch.id', '081234567002', now);
  insertUser.run('u-guru2', 'guru2', hashGuru, 'Budi Hartono, S.Si., M.Pd.', 'guru', '', '', 'aktif', malePhoto, 'budi.hartono@lenteraeduka.sch.id', '081234567003', now);
  insertUser.run('u-pengawas', 'pengawas', hashPengawas, 'Agus Setiawan, S.Pd.', 'pengawas', '', '', 'aktif', malePhoto, 'agus.setiawan@lenteraeduka.sch.id', '081234567004', now);
  insertUser.run('u-wali', 'walikelas', hashWali, 'Ahmad Fauzi, M.Pd.', 'wali_kelas', '', 'XII-IPA-1', 'aktif', malePhoto, 'ahmad.fauzi@lenteraeduka.sch.id', '081234567005', now);

  // Active students
  insertUser.run('u-s1', '2024001', hashSiswa, 'Muhammad Rizky Pratama', 'siswa', 'XII-IPA-1', '', 'aktif', malePhoto, 'rizky.pratama@siswa.lenteraeduka.sch.id', '085611112201', now);
  insertUser.run('u-s2', '2024002', hashSiswa, 'Siti Aisyah Nurhaliza', 'siswa', 'XII-IPA-1', '', 'aktif', femalePhoto, 'siti.aisyah@siswa.lenteraeduka.sch.id', '085611112202', now);
  insertUser.run('u-s3', '2024003', hashSiswa, 'Dimas Aditya Nugroho', 'siswa', 'XII-IPA-1', '', 'aktif', malePhoto, 'dimas.aditya@siswa.lenteraeduka.sch.id', '085611112203', now);
  insertUser.run('u-s4', '2024004', hashSiswa, 'Nadia Putri Kusuma', 'siswa', 'XI-IPA-1', '', 'aktif', femalePhoto, 'nadia.putri@siswa.lenteraeduka.sch.id', '085611112204', now);
  insertUser.run('u-s5', '2024005', hashSiswa, 'Farhan Maulana Hakim', 'siswa', 'X-1', '', 'aktif', malePhoto, 'farhan.hakim@siswa.lenteraeduka.sch.id', '085611112205', now);

  // Graduated Alumni (login automatically blocked!)
  insertUser.run('u-alum1', '2021001', hashSiswa, 'Raka Ramadhan Putra', 'siswa', 'XII-IPA-1', '', 'lulus', malePhoto, 'raka.ramadhan@alumni.lenteraeduka.sch.id', '085799887701', now);
  insertUser.run('u-alum2', '2021002', hashSiswa, 'Zahra Kartika Sari', 'siswa', 'XII-IPA-2', '', 'lulus', femalePhoto, 'zahra.kartika@alumni.lenteraeduka.sch.id', '085799887702', now);

  // Login slides (editable by admin)
  const insertSlide = db.prepare(`
    INSERT INTO login_slides (id, title, subtitle, tag, image_url, accent_color, sort_order, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertSlide.run(
    'sl-1',
    'Asesmen Digital Berintegritas Tinggi',
    'Ujian berbasis komputer dengan mode layar penuh terawasi, sinkronisasi luring otomatis, dan analitik butir soal presisi.',
    'CBT Terpadu',
    '/src/assets/images/slide_cbt_campus_1794936322664.jpg',
    '#0F766E',
    1,
    1
  );
  insertSlide.run(
    'sl-2',
    'Pembelajaran Kurikulum Merdeka Terstruktur',
    'Materi multimedia dwibahasa termasuk aksara Arab, penugasan terukur, tatap muka Google Meet, hingga rapor otomatis.',
    'E-Learning & Rapor',
    '/src/assets/images/slide_elearning_library_1794936323273.jpg',
    '#0369A1',
    2,
    1
  );
  insertSlide.run(
    'sl-3',
    'Presensi Biometrik & Buku Induk Terpusat',
    'Verifikasi wajah berkedip anti-foto di area sekolah, mode kiosk gerbang, dan rekapitulasi siswa hingga alumni.',
    'Presensi & Kesiswaan',
    '/src/assets/images/slide_science_lab_1794936324310.jpg',
    '#047857',
    3,
    1
  );

  // Teacher assignments (Guru Pengampu)
  const insertAssign = db.prepare(`
    INSERT INTO teacher_assignments (id, teacher_id, teacher_name, subject, class_name, academic_year)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertAssign.run('ta-1', 'u-guru1', 'Siti Rahmawati, M.Pd.', 'Matematika Wajib', 'XII-IPA-1', '2026/2027');
  insertAssign.run('ta-2', 'u-guru1', 'Siti Rahmawati, M.Pd.', 'Pendidikan Agama Islam & Bahasa Arab', 'XII-IPA-1', '2026/2027');
  insertAssign.run('ta-3', 'u-guru2', 'Budi Hartono, S.Si., M.Pd.', 'Fisika', 'XII-IPA-1', '2026/2027');
  insertAssign.run('ta-4', 'u-wali', 'Ahmad Fauzi, M.Pd.', 'Bahasa Indonesia', 'XII-IPA-1', '2026/2027');
  insertAssign.run('ta-5', 'u-guru1', 'Siti Rahmawati, M.Pd.', 'Matematika Wajib', 'XI-IPA-1', '2026/2027');

  // Schedules (Jadwal Pelajaran)
  const insertSched = db.prepare(`
    INSERT INTO schedules (id, class_name, day_name, start_time, end_time, subject, teacher_id, teacher_name, room)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertSched.run('sc-1', 'XII-IPA-1', 'Senin', '07:15', '08:45', 'Matematika Wajib', 'u-guru1', 'Siti Rahmawati, M.Pd.', 'Ruang 12A');
  insertSched.run('sc-2', 'XII-IPA-1', 'Senin', '09:00', '10:30', 'Fisika', 'u-guru2', 'Budi Hartono, S.Si., M.Pd.', 'Lab Fisika');
  insertSched.run('sc-3', 'XII-IPA-1', 'Selasa', '07:15', '08:45', 'Pendidikan Agama Islam & Bahasa Arab', 'u-guru1', 'Siti Rahmawati, M.Pd.', 'Ruang 12A');
  insertSched.run('sc-4', 'XII-IPA-1', 'Rabu', '08:00', '09:30', 'Bahasa Indonesia', 'u-wali', 'Ahmad Fauzi, M.Pd.', 'Ruang 12A');
  insertSched.run('sc-5', 'XII-IPA-1', 'Kamis', '10:00', '11:30', 'Matematika Wajib', 'u-guru1', 'Siti Rahmawati, M.Pd.', 'Lab Komputer 1');
  insertSched.run('sc-6', 'XI-IPA-1', 'Senin', '08:45', '10:15', 'Matematika Wajib', 'u-guru1', 'Siti Rahmawati, M.Pd.', 'Ruang 11A');

  // Question Banks (strictly isolated per owner_id!)
  const insertBank = db.prepare(`
    INSERT INTO question_banks (id, owner_id, owner_name, subject, grade_level, title, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertBank.run('qb-guru1-mat', 'u-guru1', 'Siti Rahmawati, M.Pd.', 'Matematika Wajib', 'XII-IPA-1', 'Bank Soal Turunan & Limit Fungsi Kelas XII', now);
  insertBank.run('qb-guru2-fis', 'u-guru2', 'Budi Hartono, S.Si., M.Pd.', 'Fisika', 'XII-IPA-1', 'Bank Soal Listrik Dinamis & Induksi Elektromagnetik (Privat Pak Budi)', now);

  const insertQ = db.prepare(`
    INSERT INTO questions (id, bank_id, owner_id, type, prompt, options_json, answer_key_json, points, explanation, difficulty_target, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // 5 questions in guru1's bank covering ALL 5 types
  insertQ.run(
    'q-1',
    'qb-guru1-mat',
    'u-guru1',
    'PG',
    'Diketahui fungsi f(x) = 3x³ - 4x² + 5x - 7. Nilai turunan pertama f\'(2) adalah ...',
    JSON.stringify([
      { key: 'A', text: '21' },
      { key: 'B', text: '25' },
      { key: 'C', text: '29' },
      { key: 'D', text: '33' },
      { key: 'E', text: '37' },
    ]),
    JSON.stringify('B'),
    20,
    'f\'(x) = 9x² - 8x + 5. Untuk x = 2: 9(4) - 8(2) + 5 = 36 - 16 + 5 = 25.',
    'Sedang',
    now
  );
  insertQ.run(
    'q-2',
    'qb-guru1-mat',
    'u-guru1',
    'PGK',
    'Pilih semua pernyataan yang BENAR mengenai kurva g(x) = x³ - 3x² + 2:',
    JSON.stringify([
      { key: 'A', text: 'Memiliki titik stasioner di x = 0 dan x = 2' },
      { key: 'B', text: 'Nilai maksimum lokal terjadi pada x = 0 dengan g(0) = 2' },
      { key: 'C', text: 'Kurva selalu naik pada interval 0 < x < 2' },
      { key: 'D', text: 'Nilai minimum lokal terjadi pada x = 2 dengan g(2) = -2' },
      { key: 'E', text: 'Turunan kedua g\'\'(1) = 6' },
    ]),
    JSON.stringify(['A', 'B', 'D']),
    20,
    'g\'(x) = 3x² - 6x = 3x(x - 2), stasioner di x=0 (maksimum lokal g(0)=2) dan x=2 (minimum lokal g(2)=-2).',
    'Sedang',
    now
  );
  insertQ.run(
    'q-3',
    'qb-guru1-mat',
    'u-guru1',
    'BS',
    'Tentukan nilai kebenaran dari setiap pernyataan limit trigonometri berikut:',
    JSON.stringify({
      statements: [
        'Nilai dari lim (x→0) sin(4x) / (2x) adalah 2.',
        'Nilai dari lim (x→0) (1 - cos 2x) / x² adalah 1.',
        'Nilai dari lim (x→0) tan(6x) / sin(3x) adalah 2.',
      ],
    }),
    JSON.stringify(['Benar', 'Salah', 'Benar']),
    20,
    'Pernyataan 2 salah karena (1 - cos 2x)/x² = 2 sin²x / x² → 2.',
    'Sedang',
    now
  );
  insertQ.run(
    'q-4',
    'qb-guru1-mat',
    'u-guru1',
    'MENJODOHKAN',
    'Pasangkan setiap fungsi berikut dengan turunan pertamanya yang tepat:',
    JSON.stringify({
      left: ['f(x) = sin(3x)', 'f(x) = cos(2x)', 'f(x) = (2x + 1)²'],
      right: ['3 cos(3x)', '-2 sin(2x)', '8x + 4', '2 sin(2x)'],
    }),
    JSON.stringify({
      'f(x) = sin(3x)': '3 cos(3x)',
      'f(x) = cos(2x)': '-2 sin(2x)',
      'f(x) = (2x + 1)²': '8x + 4',
    }),
    20,
    'Gunakan aturan rantai untuk masing-masing fungsi trigonometri dan aljabar.',
    'Mudah',
    now
  );
  insertQ.run(
    'q-5',
    'qb-guru1-mat',
    'u-guru1',
    'URAIAN',
    'Sebuah kotak tanpa tutup dengan alas persegi memiliki volume 32 cm³. Tentukan ukuran panjang sisi alas dan tinggi kotak agar luas permukaan bahan minimum, serta jelaskan langkah penyelesaiannya!',
    JSON.stringify({
      rubric: 'Skor 20: Memodelkan V = x²t = 32, L(x) = x² + 128/x, mencari L\'(x) = 2x - 128/x² = 0 → x = 4 cm, t = 2 cm.',
      maxWords: 200,
    }),
    JSON.stringify({
      modelAnswer: 'Misal sisi alas x dan tinggi t. x²t = 32 → t = 32/x². Luas permukaan L(x) = x² + 4xt = x² + 128/x. Turunan L\'(x) = 2x - 128/x² = 0 → x³ = 64 → x = 4 cm, sehingga t = 32/16 = 2 cm.',
      keywords: ['x = 4', 't = 2', 'turunan', '128'],
    }),
    20,
    'Optimalisasi nilai minimum menggunakan turunan pertama L\'(x) = 0.',
    'Sukar',
    now
  );

  // Private question in Guru 2's bank (unreachable by Guru 1!)
  insertQ.run(
    'q-fis-1',
    'qb-guru2-fis',
    'u-guru2',
    'PG',
    'Dua buah hambatan 6 Ohm dan 3 Ohm disusun paralel dan dihubungkan ke sumber tegangan 12 V. Kuat arus total rangkaian adalah ...',
    JSON.stringify([
      { key: 'A', text: '2 A' },
      { key: 'B', text: '4 A' },
      { key: 'C', text: '6 A' },
      { key: 'D', text: '8 A' },
      { key: 'E', text: '12 A' },
    ]),
    JSON.stringify('C'),
    25,
    'Rp = (6×3)/(6+3) = 2 Ohm. I = V/Rp = 12/2 = 6 A.',
    'Sedang',
    now
  );

  // CBT Exams:
  // 1) Active Live Exam for Rizky (2024001) & class XII-IPA-1 to take!
  const insertExam = db.prepare(`
    INSERT INTO cbt_exams (id, owner_id, owner_name, title, subject, class_names_json, duration_minutes, max_violations, require_fullscreen, shuffle_questions, start_at, end_at, status, question_ids_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const startWindow = new Date(Date.now() - 3600000).toISOString();
  const endWindow = new Date(Date.now() + 7 * 86400000).toISOString();

  insertExam.run(
    'ex-mat-sts',
    'u-guru1',
    'Siti Rahmawati, M.Pd.',
    'Sumatif Tengah Semester — Turunan & Limit Fungsi',
    'Matematika Wajib',
    JSON.stringify(['XII-IPA-1', 'XII-IPA-2']),
    60,
    3,
    1,
    0,
    startWindow,
    endWindow,
    'active',
    JSON.stringify(['q-1', 'q-2', 'q-3', 'q-4', 'q-5']),
    now
  );

  // 2) Completed / Analyzed Exam with 30 realistic student sessions so Item Analysis works immediately!
  insertExam.run(
    'ex-mat-latihan',
    'u-guru1',
    'Siti Rahmawati, M.Pd.',
    'Try Out Evaluasi Turunan & Limit (Analisis 30 Peserta)',
    'Matematika Wajib',
    JSON.stringify(['XII-IPA-1']),
    45,
    3,
    1,
    0,
    new Date(Date.now() - 5 * 86400000).toISOString(),
    new Date(Date.now() - 2 * 86400000).toISOString(),
    'closed',
    JSON.stringify(['q-1', 'q-2', 'q-3', 'q-4', 'q-5']),
    now
  );

  const insertSess = db.prepare(`
    INSERT INTO cbt_sessions (id, exam_id, student_id, student_name, class_name, status, violations_count, started_at, submitted_at, auto_score, manual_score, total_score, answers_json, essay_grades_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Seed 30 varied sessions for ex-mat-latihan so item analysis shows realistic P, D, r_xy, distractors, and KR-20 reliability
  const pgChoices = ['A', 'B', 'C', 'D', 'E'];
  for (let i = 1; i <= 30; i++) {
    const ability = i <= 10 ? 'high' : i <= 21 ? 'mid' : 'low';
    const ans1 = ability === 'high' ? 'B' : ability === 'mid' ? (i % 3 === 0 ? 'C' : 'B') : pgChoices[i % 5];
    const ans2 =
      ability === 'high'
        ? ['A', 'B', 'D']
        : ability === 'mid'
        ? ['A', 'B']
        : ['C', 'E'];
    const ans3 =
      ability === 'high'
        ? ['Benar', 'Salah', 'Benar']
        : ability === 'mid'
        ? ['Benar', 'Benar', 'Benar']
        : ['Salah', 'Benar', 'Salah'];
    const ans4 =
      ability === 'high'
        ? { 'f(x) = sin(3x)': '3 cos(3x)', 'f(x) = cos(2x)': '-2 sin(2x)', 'f(x) = (2x + 1)²': '8x + 4' }
        : ability === 'mid'
        ? { 'f(x) = sin(3x)': '3 cos(3x)', 'f(x) = cos(2x)': '2 sin(2x)', 'f(x) = (2x + 1)²': '8x + 4' }
        : { 'f(x) = sin(3x)': '-2 sin(2x)', 'f(x) = cos(2x)': '2 sin(2x)', 'f(x) = (2x + 1)²': '3 cos(3x)' };
    const essayScore = ability === 'high' ? 18 + (i % 3) : ability === 'mid' ? 12 + (i % 4) : 4 + (i % 5);
    const ans5 =
      ability === 'high'
        ? 'x²t = 32, L(x) = x² + 128/x, turunan L\'(x)=0 menghasilkan x = 4 cm dan t = 2 cm.'
        : 'Luas permukaan minimum dicapai saat x = 4.';

    const autoScore =
      (ans1 === 'B' ? 20 : 0) +
      (ability === 'high' ? 20 : ability === 'mid' ? 13.33 : 0) +
      (ability === 'high' ? 20 : ability === 'mid' ? 13.33 : 0) +
      (ability === 'high' ? 20 : ability === 'mid' ? 13.33 : 0);

    const total = Number((autoScore + essayScore).toFixed(2));
    insertSess.run(
      `sess-lat-${i}`,
      'ex-mat-latihan',
      i === 1 ? 'u-s1' : i === 2 ? 'u-s2' : i === 3 ? 'u-s3' : `sim-s-${i}`,
      i === 1 ? 'Muhammad Rizky Pratama' : i === 2 ? 'Siti Aisyah Nurhaliza' : i === 3 ? 'Dimas Aditya Nugroho' : `Peserta Kelas XII #${pad2(i)}`,
      'XII-IPA-1',
      'submitted',
      i === 14 ? 1 : 0,
      new Date(Date.now() - 4 * 86400000).toISOString(),
      new Date(Date.now() - 4 * 86400000 + 2100000).toISOString(),
      Number(autoScore.toFixed(2)),
      essayScore,
      total,
      JSON.stringify({ 'q-1': ans1, 'q-2': ans2, 'q-3': ans3, 'q-4': ans4, 'q-5': ans5 }),
      JSON.stringify({ 'q-5': { score: essayScore, note: 'Sudah sesuai rubrik langkah turunan.' } })
    );
  }

  // Seed 1 locked session + violation in ex-mat-sts for Dimas Aditya so Pengawas Monitor shows live unlockable case right away!
  insertSess.run(
    'sess-dimas-live',
    'ex-mat-sts',
    'u-s3',
    'Dimas Aditya Nugroho',
    'XII-IPA-1',
    'locked',
    3,
    new Date(Date.now() - 1200000).toISOString(),
    '',
    20,
    0,
    20,
    JSON.stringify({ 'q-1': 'B' }),
    JSON.stringify({})
  );
  const insertViol = db.prepare(`
    INSERT INTO cbt_violations (id, session_id, exam_id, student_id, student_name, type, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertViol.run('viol-1', 'sess-dimas-live', 'ex-mat-sts', 'u-s3', 'Dimas Aditya Nugroho', 'tab_switch', 'Berpindah ke tab browser lain selama 6 detik', new Date(Date.now() - 900000).toISOString());
  insertViol.run('viol-2', 'sess-dimas-live', 'ex-mat-sts', 'u-s3', 'Dimas Aditya Nugroho', 'copy_paste', 'Mencoba menyalin teks soal (Ctrl+C)', new Date(Date.now() - 600000).toISOString());
  insertViol.run('viol-3', 'sess-dimas-live', 'ex-mat-sts', 'u-s3', 'Dimas Aditya Nugroho', 'fullscreen_exit', 'Keluar dari mode layar penuh wajib ujian', new Date(Date.now() - 300000).toISOString());

  // E-Learning Materials (including rich text, table, Arabic RTL, YouTube embed, attachment)
  const insertMat = db.prepare(`
    INSERT INTO materials (id, teacher_id, teacher_name, subject, class_name, title, summary, blocks_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertMat.run(
    'mat-1',
    'u-guru1',
    'Siti Rahmawati, M.Pd.',
    'Matematika Wajib',
    'XII-IPA-1',
    'Konsep Dasar Turunan Fungsi Aljabar & Trigonometri',
    'Ringkasan rumus turunan dasar, aturan rantai, dan tabel turunan trigonometri beserta video pembahasan.',
    JSON.stringify([
      {
        type: 'text',
        content: 'Turunan fungsi f(x) pada titik x merepresentasikan laju perubahan sesaat atau gradien garis singgung kurva pada titik tersebut. Pastikan Anda menguasai aturan pangkat dan aturan rantai sebelum mengerjakan asesmen CBT.',
      },
      {
        type: 'table',
        headers: ['Fungsi f(x)', 'Turunan f\'(x)', 'Catatan Penggunaan'],
        rows: [
          ['xⁿ', 'n · xⁿ⁻¹', 'Berlaku untuk semua n bilangan real'],
          ['sin(ax)', 'a · cos(ax)', 'Sudut dalam satuan radian'],
          ['cos(ax)', '-a · sin(ax)', 'Perhatikan tanda negatif'],
          ['u(x) · v(x)', 'u\'v + uv\'', 'Aturan perkalian dua fungsi'],
        ],
      },
      {
        type: 'youtube',
        url: 'https://www.youtube.com/watch?v=9vKqVkMQHKk',
        caption: 'Video Penjelasan Visual Konsep Turunan (3Blue1Brown)',
      },
      {
        type: 'attachment',
        title: 'Modul_Latihan_Turunan_XII_IPA.pdf',
        url: 'https://drive.google.com/file/d/contoh-modul-turunan/view',
      },
    ]),
    now
  );
  insertMat.run(
    'mat-2',
    'u-guru1',
    'Siti Rahmawati, M.Pd.',
    'Pendidikan Agama Islam & Bahasa Arab',
    'XII-IPA-1',
    'Adab Menuntut Ilmu & Qiraah Teks Arab Klasik',
    'Kajian teks Arab tentang keutamaan ilmu pengetahuan beserta analisis kosakata.',
    JSON.stringify([
      {
        type: 'arabic',
        content: 'طَلَبُ الْعِلْمِ فَرِيضَةٌ عَلَى كُلِّ مُسْلِمٍ وَمُسْلِمَةٍ، وَمَنْ سَلَكَ طَرِيقًا يَلْتَمِسُ فِيهِ عِلْمًا سَهَّلَ اللَّهُ لَهُ بِهِ طَرِيقًا إِلَى الْجَنَّةِ',
      },
      {
        type: 'text',
        content: 'Terjemahan & Penjelasan: Menuntut ilmu adalah kewajiban setiap individu. Semangat riset dan kejujuran akademik merupakan bagian inti dari etika pelajar berintegritas.',
      },
    ]),
    now
  );

  // Material read receipts
  db.prepare(`
    INSERT INTO material_reads (material_id, student_id, student_name, class_name, read_at)
    VALUES (?, ?, ?, ?, ?)
  `).run('mat-1', 'u-s2', 'Siti Aisyah Nurhaliza', 'XII-IPA-1', now);

  // Assignments & Submissions
  const insertAsg = db.prepare(`
    INSERT INTO assignments (id, teacher_id, teacher_name, subject, class_name, title, description, deadline, max_score, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertAsg.run(
    'asg-1',
    'u-guru1',
    'Siti Rahmawati, M.Pd.',
    'Matematika Wajib',
    'XII-IPA-1',
    'Tugas Proyek: Aplikasi Nilai Maksimum-Minimum dalam Kehidupan Nyata',
    'Buatlah 1 studi kasus optimalisasi kemasan atau biaya produksi menggunakan turunan pertama. Tuliskan langkah pemodelan fungsi, turunan, hingga kesimpulan.',
    getLocalDateStr(5) + 'T23:59',
    100,
    now
  );
  db.prepare(`
    INSERT INTO assignment_submissions (id, assignment_id, student_id, student_name, class_name, answer_text, attachment_url, submitted_at, score, teacher_note, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'sub-1',
    'asg-1',
    'u-s2',
    'Siti Aisyah Nurhaliza',
    'XII-IPA-1',
    'Model kotak silinder volume 500 ml: L(r) = 2πr² + 1000/r, minimum dicapai saat L\'(r)=0 yaitu r ≈ 4.30 cm.',
    'https://drive.google.com/file/d/aisyah-proyek-turunan/view',
    now,
    94,
    'Pemodelan fungsi sangat rapi dan pembuktian uji turunan kedua sudah tepat.',
    'dinilai'
  );

  // Attendance Settings & Logs
  db.prepare(`
    INSERT INTO attendance_settings (id, school_name, school_lat, school_lng, radius_meters, entry_time, late_tolerance_min, checkout_time)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?)
  `).run('SMA Negeri Terpadu Lentera Eduka', -7.257472, 112.752088, 250, '07:00', 15, '15:00');

  const insertAtt = db.prepare(`
    INSERT INTO attendance_logs (id, student_id, student_name, class_name, date, check_in_time, check_out_time, status, method, liveness_blink_verified, distance_meters, note, recorded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertAtt.run('att-1', 'u-s1', 'Muhammad Rizky Pratama', 'XII-IPA-1', getLocalDateStr(-2), '06:52', '15:08', 'Hadir', 'face_mobile', 1, 38, 'Verifikasi wajah berkedip berhasil', 'Siswa (HP)');
  insertAtt.run('att-2', 'u-s1', 'Muhammad Rizky Pratama', 'XII-IPA-1', getLocalDateStr(-1), '07:21', '15:05', 'Terlambat', 'kiosk', 1, 12, 'Kiosk Gerbang Utama', 'Kiosk Gerbang');
  insertAtt.run('att-3', 'u-s2', 'Siti Aisyah Nurhaliza', 'XII-IPA-1', getLocalDateStr(-2), '06:48', '15:12', 'Hadir', 'kiosk', 1, 10, 'Kiosk Gerbang Utama', 'Kiosk Gerbang');
  insertAtt.run('att-4', 'u-s2', 'Siti Aisyah Nurhaliza', 'XII-IPA-1', getLocalDateStr(-1), '06:55', '15:04', 'Hadir', 'face_mobile', 1, 42, 'Verifikasi wajah berkedip berhasil', 'Siswa (HP)');
  insertAtt.run('att-5', 'u-s3', 'Dimas Aditya Nugroho', 'XII-IPA-1', getLocalDateStr(-1), '', '', 'Izin', 'manual', 0, null, 'Izin mengikuti lomba karya ilmiah tingkat provinsi', 'Ahmad Fauzi, M.Pd.');

  // Kurikulum Merdeka Learning Objectives (TP)
  const insertTP = db.prepare(`
    INSERT INTO learning_objectives (id, teacher_id, subject, class_name, semester, code, description)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertTP.run('tp-1', 'u-guru1', 'Matematika Wajib', 'XII-IPA-1', 'Ganjil', 'TP-M1', 'menentukan nilai limit fungsi aljabar dan trigonometri secara analitik');
  insertTP.run('tp-2', 'u-guru1', 'Matematika Wajib', 'XII-IPA-1', 'Ganjil', 'TP-M2', 'menerapkan konsep turunan pertama dan aturan rantai pada masalah gradien dan kemonotonan');
  insertTP.run('tp-3', 'u-guru1', 'Matematika Wajib', 'XII-IPA-1', 'Ganjil', 'TP-M3', 'memecahkan persoalan optimalisasi nilai maksimum dan minimum dalam konteks nyata');
  insertTP.run('tp-4', 'u-guru2', 'Fisika', 'XII-IPA-1', 'Ganjil', 'TP-F1', 'menganalisis rangkaian listrik arus searah dan hukum Kirchhoff');
  insertTP.run('tp-5', 'u-wali', 'Bahasa Indonesia', 'XII-IPA-1', 'Ganjil', 'TP-B1', 'menyusun teks editorial dan artikel ilmiah populer secara kohesif');

  // Rapor Subject Scores
  const insertRaporSubj = db.prepare(`
    INSERT INTO rapor_subject_scores (id, student_id, subject, class_name, semester, academic_year, teacher_id, harian_score, pts_score, pas_score, weight_harian, weight_pts, weight_pas, final_score, tp_achieved_ids_json, tp_needs_guidance_ids_json, competency_description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertRaporSubj.run(
    'rs-1',
    'u-s1',
    'Matematika Wajib',
    'XII-IPA-1',
    'Ganjil',
    '2026/2027',
    'u-guru1',
    88,
    85,
    90,
    50,
    25,
    25,
    87.75,
    JSON.stringify(['tp-1', 'tp-2']),
    JSON.stringify(['tp-3']),
    'Menunjukkan penguasaan yang sangat baik dalam menentukan nilai limit fungsi aljabar dan trigonometri secara analitik serta menerapkan konsep turunan pertama. Perlu bimbingan lebih lanjut dalam memecahkan persoalan optimalisasi nilai maksimum dan minimum dalam konteks nyata.'
  );
  insertRaporSubj.run(
    'rs-2',
    'u-s1',
    'Fisika',
    'XII-IPA-1',
    'Ganjil',
    '2026/2027',
    'u-guru2',
    86,
    84,
    88,
    50,
    25,
    25,
    86.0,
    JSON.stringify(['tp-4']),
    JSON.stringify([]),
    'Menunjukkan penguasaan yang sangat baik dalam menganalisis rangkaian listrik arus searah dan hukum Kirchhoff.'
  );
  insertRaporSubj.run(
    'rs-3',
    'u-s1',
    'Bahasa Indonesia',
    'XII-IPA-1',
    'Ganjil',
    '2026/2027',
    'u-wali',
    91,
    88,
    92,
    50,
    25,
    25,
    90.5,
    JSON.stringify(['tp-5']),
    JSON.stringify([]),
    'Menunjukkan penguasaan yang sangat baik dalam menyusun teks editorial dan artikel ilmiah populer secara kohesif.'
  );
  insertRaporSubj.run(
    'rs-4',
    'u-s2',
    'Matematika Wajib',
    'XII-IPA-1',
    'Ganjil',
    '2026/2027',
    'u-guru1',
    94,
    92,
    95,
    50,
    25,
    25,
    93.75,
    JSON.stringify(['tp-1', 'tp-2', 'tp-3']),
    JSON.stringify([]),
    'Menunjukkan penguasaan yang sangat baik dalam seluruh capaian kompetensi limit, turunan pertama, hingga optimalisasi kontekstual.'
  );
  insertRaporSubj.run(
    'rs-5',
    'u-s2',
    'Fisika',
    'XII-IPA-1',
    'Ganjil',
    '2026/2027',
    'u-guru2',
    90,
    89,
    91,
    50,
    25,
    25,
    90.0,
    JSON.stringify(['tp-4']),
    JSON.stringify([]),
    'Menunjukkan penguasaan yang sangat baik dalam menganalisis rangkaian listrik arus searah dan hukum Kirchhoff.'
  );
  insertRaporSubj.run(
    'rs-6',
    'u-s3',
    'Matematika Wajib',
    'XII-IPA-1',
    'Ganjil',
    '2026/2027',
    'u-guru1',
    78,
    76,
    80,
    50,
    25,
    25,
    78.0,
    JSON.stringify(['tp-1']),
    JSON.stringify(['tp-3']),
    'Menunjukkan penguasaan yang baik dalam menentukan nilai limit fungsi. Perlu bimbingan dalam pemodelan optimalisasi nilai maksimum dan minimum.'
  );

  // Rapor Homeroom
  const insertHomeroom = db.prepare(`
    INSERT INTO rapor_homeroom (id, student_id, class_name, semester, academic_year, extracurricular_json, sakit, izin, alpha, homeroom_note, promotion_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertHomeroom.run(
    'rh-1',
    'u-s1',
    'XII-IPA-1',
    'Ganjil',
    '2026/2027',
    JSON.stringify([
      { name: 'Pramuka Wajib', predicate: 'Sangat Baik', note: 'Aktif dalam kepemimpinan sangga.' },
      { name: 'Klub Robotik & Sains', predicate: 'Baik', note: 'Berpartisipasi pada kompetisi proyek sensor.' },
    ]),
    0,
    0,
    0,
    'Ananda Rizky konsisten dalam kedisiplinan dan menunjukkan ketekunan belajar yang baik pada semester ini.',
    'Proses'
  );
  insertHomeroom.run(
    'rh-2',
    'u-s2',
    'XII-IPA-1',
    'Ganjil',
    '2026/2027',
    JSON.stringify([
      { name: 'Karya Ilmiah Remaja (KIR)', predicate: 'Sangat Baik', note: 'Juara harapan 1 lomba esai sains.' },
    ]),
    0,
    0,
    0,
    'Pertahankan prestasi akademik dan kepemimpinan kolaboratif di kelas.',
    'Proses'
  );

  // Buku Induk (Student Master Records) + Class History + Alumni
  const insertMaster = db.prepare(`
    INSERT INTO student_master_records (student_id, nis, nisn, birth_place, birth_date, gender, religion, address, father_name, father_job, mother_name, mother_job, parent_phone, entry_year, previous_school, photo_url, graduation_year, diploma_number, alumni_destination, alumni_notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertMaster.run('u-s1', '2024001', '0081234501', 'Surabaya', '2008-08-17', 'Laki-laki', 'Islam', 'Jl. Dharmahusada Indah No. 42, Surabaya', 'Ir. Bambang Pratama', 'Insinyur Sipil', 'Dra. Ratna Dewi', 'Guru SMP', '081231110001', '2024', 'SMPN 1 Surabaya', malePhoto, '', '', '', '');
  insertMaster.run('u-s2', '2024002', '0081234502', 'Sidoarjo', '2008-11-03', 'Perempuan', 'Islam', 'Perum Taman Pinang Blok C-12, Sidoarjo', 'H. Abdul Halim', 'Wiraswasta', 'Hj. Nurul Hidayah', 'Ibu Rumah Tangga', '081231110002', '2024', 'SMPN 2 Sidoarjo', femalePhoto, '', '', '', '');
  insertMaster.run('u-s3', '2024003', '0081234503', 'Malang', '2009-01-22', 'Laki-laki', 'Islam', 'Jl. Kertajaya No. 88, Surabaya', 'Teguh Nugroho', 'Pegawai BUMN', 'Sri Wahyuni', 'Akuntan', '081231110003', '2024', 'SMPN 6 Surabaya', malePhoto, '', '', '', '');
  insertMaster.run('u-s4', '2024004', '0091234504', 'Surabaya', '2009-04-12', 'Perempuan', 'Kristen', 'Jl. Raya Kupang Indah 19, Surabaya', 'Andreas Kusuma', 'Dokter', 'Lidya Hartini', 'Apoteker', '081231110004', '2025', 'SMPK Santa Maria', femalePhoto, '', '', '', '');
  insertMaster.run('u-s5', '2024005', '0101234505', 'Gresik', '2010-02-09', 'Laki-laki', 'Islam', 'Jl. Dr. Wahidin No. 14, Gresik', 'Lukman Hakim', 'Karyawan Swasta', 'Aminah Zuhri', 'Pedagang', '081231110005', '2026', 'SMPN 1 Gresik', malePhoto, '', '', '', '');
  insertMaster.run('u-alum1', '2021001', '0059876501', 'Surabaya', '2006-03-19', 'Laki-laki', 'Islam', 'Jl. Mulyosari Tengah No. 7, Surabaya', 'Sutrisno Putra', 'Dosen', 'Endang Lestari', 'PNS', '081239990001', '2021', 'SMPN 19 Surabaya', malePhoto, '2025', 'DN-05/MA/2025/00412', 'Institut Teknologi Sepuluh Nopember (Teknik Informatika)', 'Lulus predikat sangat memuaskan');
  insertMaster.run('u-alum2', '2021002', '0059876502', 'Surabaya', '2006-07-28', 'Perempuan', 'Islam', 'Jl. Ngagel Jaya Selatan 55, Surabaya', 'Darmawan', 'Wiraswasta', 'Murniati', 'Bidan', '081239990002', '2021', 'SMPN 12 Surabaya', femalePhoto, '2025', 'DN-05/MA/2025/00418', 'Universitas Airlangga (Kedokteran)', 'Aktif sebagai mentor alumni');

  const insertHist = db.prepare(`
    INSERT INTO class_history (id, student_id, academic_year, semester, class_name, average_score, rank_in_class, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertHist.run('ch-1', 'u-s1', '2024/2025', 'Ganjil', 'X-1', 85.4, 6, 'Naik Kelas');
  insertHist.run('ch-2', 'u-s1', '2024/2025', 'Genap', 'X-1', 86.8, 5, 'Naik Kelas');
  insertHist.run('ch-3', 'u-s1', '2025/2026', 'Ganjil', 'XI-IPA-1', 87.2, 4, 'Naik Kelas');
  insertHist.run('ch-4', 'u-s1', '2025/2026', 'Genap', 'XI-IPA-1', 88.5, 3, 'Naik Kelas');
  insertHist.run('ch-5', 'u-s2', '2025/2026', 'Genap', 'XI-IPA-1', 92.4, 1, 'Naik Kelas');
  insertHist.run('ch-6', 'u-alum1', '2024/2025', 'Genap', 'XII-IPA-1', 91.2, 2, 'Lulus');

  // Online Meetings (Google Meet) — scheduled today so Student "Kelas online hari ini" & "Online" tab work live!
  const insertMeet = db.prepare(`
    INSERT INTO online_meetings (id, series_id, teacher_id, teacher_name, title, subject, class_name, meeting_date, start_time, end_time, meet_url, meet_code, repeat_weeks, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const todayStr = getLocalDateStr(0);
  // Active window right now (started 5 mins ago, ends in 55 mins)
  insertMeet.run(
    'meet-live-now',
    'ser-1',
    'u-guru1',
    'Siti Rahmawati, M.Pd.',
    'Klinik Soal Turunan & Pembahasan Pra-STS',
    'Matematika Wajib',
    'XII-IPA-1',
    todayStr,
    getTimeOffsetStr(-5),
    getTimeOffsetStr(55),
    'https://meet.google.com/abc-defg-hij',
    'abc-defg-hij',
    1,
    now
  );
  // Upcoming later today (opens in ~2 hours -> tests "belum dibuka" opening time message!)
  insertMeet.run(
    'meet-later-today',
    'ser-2',
    'u-guru1',
    'Siti Rahmawati, M.Pd.',
    'Kajian Teks Arab & Adab Akademik',
    'Pendidikan Agama Islam & Bahasa Arab',
    'XII-IPA-1',
    todayStr,
    getTimeOffsetStr(130),
    getTimeOffsetStr(190),
    'https://meet.google.com/klm-nopq-rst',
    'klm-nopq-rst',
    1,
    now
  );
  // Class restriction test: XI-IPA-1 meeting (must NOT allow XII-IPA-1 student to join!)
  insertMeet.run(
    'meet-other-class',
    'ser-3',
    'u-guru1',
    'Siti Rahmawati, M.Pd.',
    'Pengayaan Matriks Kelas XI',
    'Matematika Wajib',
    'XI-IPA-1',
    todayStr,
    getTimeOffsetStr(-5),
    getTimeOffsetStr(55),
    'https://meet.google.com/xyz-uvwx-stu',
    'xyz-uvwx-stu',
    1,
    now
  );
}

seedDatabaseIfEmpty();
