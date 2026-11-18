export type UserRole = 'admin' | 'guru' | 'pengawas' | 'wali_kelas' | 'siswa';

export interface User {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  className: string;
  homeroomClass: string;
  photoUrl: string;
  email: string;
}

export interface LoginSlide {
  id: string;
  title: string;
  subtitle: string;
  tag: string;
  image_url: string;
  accent_color: string;
  sort_order: number;
  is_active: number;
}

export type QuestionType = 'PG' | 'PGK' | 'BS' | 'MENJODOHKAN' | 'URAIAN';

export interface QuestionItem {
  id: string;
  bankId?: string;
  type: QuestionType;
  prompt: string;
  options: any;
  answerKey?: any;
  points: number;
  explanation?: string;
  difficultyTarget?: string;
}

export interface MaterialBlock {
  type: 'text' | 'arabic' | 'table' | 'youtube' | 'image' | 'attachment';
  content?: string;
  headers?: string[];
  rows?: string[][];
  url?: string;
  caption?: string;
  title?: string;
}

export interface MeetingItem {
  id: string;
  series_id: string;
  teacher_id: string;
  teacher_name: string;
  title: string;
  subject: string;
  class_name: string;
  meeting_date: string;
  start_time: string;
  end_time: string;
  meet_url: string;
  meet_code: string;
  repeat_weeks: number;
  canJoin: boolean;
  state: 'terbuka' | 'belum_dibuka' | 'selesai';
  opensAtLabel: string;
  message: string;
  attendanceCount: number;
  joinedByMe: boolean;
}

export type NavSection =
  | 'beranda'
  | 'elearning'
  | 'online'
  | 'cbt'
  | 'absensi'
  | 'rapor'
  | 'buku_induk'
  | 'slider_login'
  | 'users_audit';

export interface StudentActivityItem {
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
}

export interface StudentActivityFeedResponse {
  items: StudentActivityItem[];
  counts: {
    all: number;
    cbt: number;
    tugas: number;
    lainnya: number;
  };
}

