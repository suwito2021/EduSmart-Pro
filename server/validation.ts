import { z } from 'zod';

export const loginSchema = z.object({
  username: z.string().trim().min(2, 'Username/NISN minimal 2 karakter').max(64),
  password: z.string().min(4, 'Kata sandi minimal 4 karakter').max(128),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Kata sandi saat ini wajib diisi'),
  newPassword: z.string().min(6, 'Kata sandi baru minimal 6 karakter').max(128),
});

export const slideSchema = z.object({
  title: z.string().trim().min(3).max(160),
  subtitle: z.string().trim().min(5).max(400),
  tag: z.string().trim().max(60).optional().default('Informasi Sekolah'),
  imageUrl: z.string().trim().min(1).max(500).optional(),
  accentColor: z.string().trim().max(20).optional().default('#0F766E'),
  sortOrder: z.coerce.number().int().min(1).max(99).optional().default(1),
  isActive: z.boolean().optional().default(true),
});

export const aiKeySchema = z.object({
  provider: z.enum(['gemini', 'claude', 'openai', 'openrouter']),
  apiKey: z.string().trim().min(8, 'API key minimal 8 karakter').max(300),
  modelName: z.string().trim().max(120).optional().default(''),
});

export const aiGenerateSchema = z.object({
  provider: z.enum(['gemini', 'claude', 'openai', 'openrouter']).default('gemini'),
  model: z.string().trim().max(120).optional(),
  subject: z.string().trim().min(2).max(120),
  gradeLevel: z.string().trim().max(60).optional().default('XII'),
  topic: z.string().trim().min(3).max(300),
  questionTypes: z.array(z.enum(['PG', 'PGK', 'BS', 'MENJODOHKAN', 'URAIAN'])).min(1),
  count: z.coerce.number().int().min(1).max(15).default(5),
  difficulty: z.enum(['Mudah', 'Sedang', 'Sukar', 'Campuran']).default('Campuran'),
  additionalInstructions: z.string().trim().max(500).optional(),
});

export const createExamSchema = z.object({
  title: z.string().trim().min(3).max(180),
  subject: z.string().trim().min(2).max(120),
  classNames: z.array(z.string().trim().min(1)).min(1),
  durationMinutes: z.coerce.number().int().min(5).max(360).default(60),
  maxViolations: z.coerce.number().int().min(1).max(20).default(3),
  requireFullscreen: z.boolean().default(true),
  shuffleQuestions: z.boolean().optional().default(false),
  shuffleOptions: z.boolean().optional().default(false),
  startAt: z.string().trim().optional(),
  endAt: z.string().trim().optional(),
  questionIds: z.array(z.string().trim().min(1)).min(1),
});

export const uploadSchema = z.object({
  filename: z.string().trim().min(1).max(180),
  mimeType: z.string().trim().min(3).max(120),
  dataBase64: z.string().min(4).max(9_000_000),
});

export const attendanceSettingsSchema = z.object({
  schoolName: z.string().trim().min(3).max(180),
  schoolLat: z.coerce.number().min(-90).max(90),
  schoolLng: z.coerce.number().min(-180).max(180),
  radiusMeters: z.coerce.number().int().min(20).max(5000),
  entryTime: z.string().regex(/^\d{2}:\d{2}$/),
  lateToleranceMin: z.coerce.number().int().min(0).max(120),
  checkoutTime: z.string().regex(/^\d{2}:\d{2}$/),
  timezone: z.enum(['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura']).default('Asia/Jakarta'),
});

export const createMeetingSchema = z.object({
  title: z.string().trim().min(3).max(180),
  subject: z.string().trim().min(2).max(120),
  className: z.string().trim().min(2).max(40),
  meetingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  meetInput: z.string().trim().min(5).max(300),
  repeatWeeks: z.coerce.number().int().min(1).max(16).default(1),
});

export const userUpsertSchema = z.object({
  username: z.string().trim().min(3).max(50),
  name: z.string().trim().min(2).max(120),
  role: z.enum(['admin', 'guru', 'pengawas', 'wali_kelas', 'siswa']),
  className: z.string().trim().max(40).optional().default(''),
  homeroomClass: z.string().trim().max(40).optional().default(''),
  status: z.enum(['aktif', 'lulus', 'nonaktif']).optional().default('aktif'),
  email: z.string().trim().max(120).optional().default(''),
  phone: z.string().trim().max(30).optional().default(''),
  password: z.string().min(6).max(128).optional(),
});
