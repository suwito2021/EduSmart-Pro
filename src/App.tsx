import React, { useEffect, useState } from 'react';
import {
  Award,
  BookOpen,
  ClipboardCheck,
  GraduationCap,
  Home,
  KeyRound,
  LayoutPanelLeft,
  LogOut,
  Menu,
  Moon,
  ScanFace,
  ShieldCheck,
  Sun,
  Users,
  Video,
  X,
} from 'lucide-react';
import { apiFetch, setStoredToken } from './lib/api';
import { useTheme } from './lib/theme';
import type { NavSection, User } from './types';
import { PetalLogo } from './components/PetalLogo';
import { LoginPage } from './components/LoginPage';
import { CbtExamRunner } from './components/CbtExamRunner';
import { CbtModule } from './components/CbtModule';
import { ElearningModule } from './components/ElearningModule';
import { OnlineMeetingsSection } from './components/OnlineMeetingsSection';
import { AttendanceModule } from './components/AttendanceModule';
import { RaporModule } from './components/RaporModule';
import { BukuIndukModule } from './components/BukuIndukModule';
import { AdminSlidesManager } from './components/AdminSlidesManager';
import { AdminUsersAudit } from './components/AdminUsersAudit';
import { StudentActivityFeed } from './components/StudentActivityFeed';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const { theme, toggleTheme } = useTheme();
  const [section, setSection] = useState<NavSection>('beranda');
  const [activeExamId, setActiveExamId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pwModalOpen, setPwModalOpen] = useState(false);
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [pwNotice, setPwNotice] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwSaving, setPwSaving] = useState(false);

  // Student / Teacher Beranda summary data
  const [homeData, setHomeData] = useState<{
    exams: any[];
    assignments: any[];
    materials: any[];
  }>({ exams: [], assignments: [], materials: [] });

  useEffect(() => {
    apiFetch<User>('/api/auth/me')
      .then((u) => setUser(u))
      .catch(() => setStoredToken(''))
      .finally(() => setBooting(false));
  }, []);

  useEffect(() => {
    if (!user || activeExamId) return;
    if (user.role === 'pengawas') {
      setSection('cbt');
      return;
    }
    Promise.all([
      apiFetch<any[]>('/api/cbt/exams').catch(() => []),
      apiFetch<any[]>('/api/elearning/assignments').catch(() => []),
      apiFetch<any[]>('/api/elearning/materials').catch(() => []),
    ]).then(([exams, assignments, materials]) => {
      setHomeData({ exams, assignments, materials });
    });
  }, [user, activeExamId, section]);

  async function handleLogout() {
    if (activeExamId) return; // Locked during active CBT exam
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setStoredToken('');
    setUser(null);
    setSection('beranda');
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError('');
    setPwNotice('');
    if (pwForm.newPassword.length < 6) {
      setPwError('Kata sandi baru minimal 6 karakter.');
      return;
    }
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      setPwError('Konfirmasi kata sandi baru tidak cocok.');
      return;
    }
    setPwSaving(true);
    try {
      const res = await apiFetch<{ ok: boolean; token: string }>('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: pwForm.currentPassword,
          newPassword: pwForm.newPassword,
        }),
      });
      if (res.token) setStoredToken(res.token);
      setPwNotice('Kata sandi berhasil diperbarui. Sesi di perangkat lain otomatis dicabut.');
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err: any) {
      setPwError(err?.message || 'Gagal mengganti kata sandi.');
    } finally {
      setPwSaving(false);
    }
  }

  if (booting) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center text-sm text-slate-500 dark:text-slate-400">
        Memuat portal akademik...
      </div>
    );
  }

  if (!user) {
    return (
      <LoginPage
        onLoginSuccess={(loggedInUser) => {
          setUser(loggedInUser);
          setSection(loggedInUser.role === 'pengawas' ? 'cbt' : 'beranda');
        }}
      />
    );
  }

  // Fullscreen Locked Exam Runner (hides all portal navigation & logout!)
  if (activeExamId && user.role === 'siswa') {
    return (
      <CbtExamRunner
        examId={activeExamId}
        user={user}
        onExitAfterFinish={() => {
          setActiveExamId(null);
          setSection('cbt');
        }}
      />
    );
  }

  const isStudent = user.role === 'siswa';
  const isAdmin = user.role === 'admin';
  const isProctor = user.role === 'pengawas';

  const navItems: Array<{ id: NavSection; label: string; icon: React.ComponentType<{ className?: string }> }> = isStudent
    ? [
        { id: 'beranda', label: 'Beranda', icon: Home },
        { id: 'elearning', label: 'E-Learning', icon: BookOpen },
        { id: 'online', label: 'Online', icon: Video },
        { id: 'cbt', label: 'Ujian CBT', icon: ClipboardCheck },
        { id: 'absensi', label: 'Absensi Wajah', icon: ScanFace },
        { id: 'rapor', label: 'Rapor Saya', icon: Award },
      ]
    : isProctor
    ? [{ id: 'cbt', label: 'Monitor Pengawas', icon: ShieldCheck }]
    : [
        { id: 'beranda', label: 'Beranda', icon: Home },
        { id: 'cbt', label: 'CBT & Soal AI', icon: ClipboardCheck },
        { id: 'elearning', label: 'E-Learning', icon: BookOpen },
        { id: 'absensi', label: 'Absensi & Kiosk', icon: ScanFace },
        { id: 'rapor', label: 'Rapor Merdeka', icon: Award },
        { id: 'buku_induk', label: 'Buku Induk & Alumni', icon: GraduationCap },
        ...(isAdmin
          ? [
              { id: 'users_audit' as NavSection, label: 'Pengguna & Audit', icon: Users },
              { id: 'slider_login' as NavSection, label: 'Slider Login', icon: LayoutPanelLeft },
            ]
          : []),
      ];

  const roleLabel =
    user.role === 'admin'
      ? 'Administrator'
      : user.role === 'guru'
      ? 'Guru Mapel'
      : user.role === 'pengawas'
      ? 'Pengawas Ujian'
      : user.role === 'wali_kelas'
      ? `Wali Kelas ${user.homeroomClass}`
      : `Siswa · ${user.className}`;

  const currentNavLabel = navItems.find((n) => n.id === section)?.label || 'Portal';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 no-print">
        <div className="flex items-center gap-3 px-6 py-5 border-b border-slate-200 dark:border-slate-800">
          <PetalLogo size={30} />
          <div className="min-w-0">
            <p className="font-display text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 truncate">
              Lentera Eduka
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{roleLabel}</p>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`w-full flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300 font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-teal-700 dark:text-teal-400' : 'text-slate-400 dark:text-slate-500'}`} />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center gap-3">
            <img
              src={user.photoUrl || '/src/assets/images/avatar_student_male_1794936325167.jpg'}
              alt={user.name}
              referrerPolicy="no-referrer"
              className="h-9 w-9 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
            />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">{user.name}</p>
              <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">{user.username}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            aria-pressed={theme === 'dark'}
            aria-label={theme === 'dark' ? 'Beralih ke mode terang' : 'Beralih ke mode gelap'}
            className="w-full flex items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span className="inline-flex items-center gap-2">
              {theme === 'dark' ? (
                <Sun className="h-3.5 w-3.5 text-amber-400 shrink-0" />
              ) : (
                <Moon className="h-3.5 w-3.5 text-slate-600 shrink-0" />
              )}
              <span>{theme === 'dark' ? 'Mode Terang' : 'Mode Gelap'}</span>
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {theme === 'dark' ? 'Gelap' : 'Terang'}
            </span>
          </button>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setPwError('');
                setPwNotice('');
                setPwModalOpen(true);
              }}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <KeyRound className="h-3.5 w-3.5" />
              <span>Ubah Sandi</span>
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Keluar</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex-1 lg:pl-64 flex flex-col min-h-screen pb-16 md:pb-0">
        {/* Top Bar Contract */}
        <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800 px-4 sm:px-8 py-3.5 flex items-center justify-between gap-4 no-print">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="lg:hidden p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 cursor-pointer"
              aria-label="Menu"
            >
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
            <div className="flex items-center gap-2 text-xs sm:text-sm text-slate-500 dark:text-slate-400 truncate">
              <span className="font-display font-bold text-slate-900 dark:text-slate-100 whitespace-nowrap">Lentera Eduka</span>
              <span aria-hidden="true">/</span>
              <span className="font-medium text-slate-700 dark:text-slate-300 truncate">{currentNavLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="hidden sm:inline text-xs text-slate-600 dark:text-slate-300">{user.name}</span>
            <button
              type="button"
              onClick={toggleTheme}
              aria-pressed={theme === 'dark'}
              aria-label={theme === 'dark' ? 'Beralih ke mode terang' : 'Beralih ke mode gelap'}
              className="lg:hidden inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {theme === 'dark' ? (
                <Sun className="h-3.5 w-3.5 text-amber-400" />
              ) : (
                <Moon className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">{theme === 'dark' ? 'Terang' : 'Gelap'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setPwError('');
                setPwNotice('');
                setPwModalOpen(true);
              }}
              className="lg:hidden inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              <KeyRound className="h-3.5 w-3.5" />
              <span>Sandi</span>
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="lg:hidden inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Keluar</span>
            </button>
          </div>
        </header>

        {/* Mobile Slide-down Menu */}
        {mobileMenuOpen && (
          <div className="lg:hidden bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-3 space-y-1 no-print">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSection(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
                    section === item.id
                      ? 'bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300 font-semibold'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => {
                toggleTheme();
                setMobileMenuOpen(false);
              }}
              className="w-full flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 border-t border-slate-100 dark:border-slate-800 mt-2 pt-2.5"
            >
              <span className="inline-flex items-center gap-3">
                {theme === 'dark' ? (
                  <Sun className="h-4 w-4 text-amber-400" />
                ) : (
                  <Moon className="h-4 w-4 text-slate-500" />
                )}
                <span>{theme === 'dark' ? 'Ganti ke Mode Terang' : 'Ganti ke Mode Gelap'}</span>
              </span>
            </button>
          </div>
        )}

        {/* Viewport Content */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-8 py-6 sm:py-8">
          {/* BERANDA */}
          {section === 'beranda' && (
            <div className="space-y-8">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-medium text-teal-700 dark:text-teal-400">{roleLabel}</p>
                  <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-1">
                    Selamat Datang, {user.name}
                  </h1>
                </div>
                {isStudent && (
                  <button
                    type="button"
                    onClick={() => setSection('absensi')}
                    className="inline-flex items-center gap-2 rounded-xl bg-teal-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-teal-800 cursor-pointer"
                  >
                    <ScanFace className="h-4 w-4" />
                    <span>Absen Wajah Sekarang</span>
                  </button>
                )}
              </div>

              {/* Student Card: "Kelas online hari ini" */}
              {isStudent && (
                <section className="rounded-2xl border border-teal-200 dark:border-teal-800 bg-white dark:bg-slate-900 p-6 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <Video className="h-5 w-5 text-teal-700 dark:text-teal-400" />
                      <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">Kelas online hari ini</h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSection('online')}
                      className="text-xs font-semibold text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
                    >
                      Lihat semua jadwal
                    </button>
                  </div>
                  <OnlineMeetingsSection user={user} compactTodayOnly />
                </section>
              )}

              {/* Summary KPIs */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div
                  onClick={() => setSection('cbt')}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-1 hover:border-teal-600 dark:hover:border-teal-500 transition-colors cursor-pointer"
                >
                  <p className="text-xs text-slate-500 dark:text-slate-400">Ujian CBT Tersedia</p>
                  <p className="font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">{homeData.exams.length}</p>
                  <p className="text-xs text-teal-700 dark:text-teal-400 font-medium">Buka portal ujian →</p>
                </div>
                <div
                  onClick={() => setSection('elearning')}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-1 hover:border-teal-600 dark:hover:border-teal-500 transition-colors cursor-pointer"
                >
                  <p className="text-xs text-slate-500 dark:text-slate-400">Materi &amp; Tugas Aktif</p>
                  <p className="font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                    {homeData.materials.length} / {homeData.assignments.length}
                  </p>
                  <p className="text-xs text-teal-700 dark:text-teal-400 font-medium">Buka E-Learning →</p>
                </div>
                <div
                  onClick={() => setSection('rapor')}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-1 hover:border-teal-600 dark:hover:border-teal-500 transition-colors cursor-pointer"
                >
                  <p className="text-xs text-slate-500 dark:text-slate-400">Rapor Kurikulum Merdeka</p>
                  <p className="font-display text-lg font-bold text-slate-900 dark:text-slate-100 mt-1">Semester Ganjil 2026/2027</p>
                  <p className="text-xs text-teal-700 dark:text-teal-400 font-medium">Lihat capaian &amp; cetak A4 →</p>
                </div>
              </div>

              {/* Student Activity Feed */}
              {isStudent && <StudentActivityFeed onNavigate={(next) => setSection(next)} />}
            </div>
          )}

          {section === 'online' && <OnlineMeetingsSection user={user} />}
          {section === 'cbt' && <CbtModule user={user} onStartExam={(id) => setActiveExamId(id)} />}
          {section === 'elearning' && <ElearningModule user={user} />}
          {section === 'absensi' && <AttendanceModule user={user} />}
          {section === 'rapor' && <RaporModule user={user} />}
          {section === 'buku_induk' && !isStudent && <BukuIndukModule user={user} />}
          {section === 'users_audit' && isAdmin && <AdminUsersAudit />}
          {section === 'slider_login' && isAdmin && <AdminSlidesManager />}
        </main>
      </div>

      {/* Self-service Change Password Modal */}
      {pwModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-slate-950/75 flex items-center justify-center p-4 no-print">
          <div className="max-w-md w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">Ubah Kata Sandi</h3>
              <button
                type="button"
                onClick={() => setPwModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                aria-label="Tutup"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Mengubah kata sandi akan otomatis mencabut sesi login Anda di perangkat lain.
            </p>
            {pwNotice && (
              <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300">
                {pwNotice}
              </div>
            )}
            {pwError && (
              <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                {pwError}
              </div>
            )}
            <form onSubmit={handleChangePassword} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Kata Sandi Saat Ini</label>
                <input
                  required
                  type="password"
                  value={pwForm.currentPassword}
                  onChange={(e) => setPwForm({ ...pwForm, currentPassword: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Kata Sandi Baru (min. 6 karakter)</label>
                <input
                  required
                  minLength={6}
                  type="password"
                  value={pwForm.newPassword}
                  onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Ulangi Kata Sandi Baru</label>
                <input
                  required
                  minLength={6}
                  type="password"
                  value={pwForm.confirmPassword}
                  onChange={(e) => setPwForm({ ...pwForm, confirmPassword: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPwModalOpen(false)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Tutup
                </button>
                <button
                  type="submit"
                  disabled={pwSaving}
                  className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white hover:bg-teal-800 disabled:opacity-60 cursor-pointer"
                >
                  {pwSaving ? 'Menyimpan...' : 'Simpan Sandi Baru'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Student Mobile Bottom Navigation Bar (includes "Online" menu!) */}
      {isStudent && (
        <nav
          aria-label="Navigasi bawah siswa"
          className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 grid grid-cols-5 h-14 no-print"
        >
          {[
            { id: 'beranda' as NavSection, label: 'Beranda', icon: Home },
            { id: 'elearning' as NavSection, label: 'Materi', icon: BookOpen },
            { id: 'online' as NavSection, label: 'Online', icon: Video },
            { id: 'cbt' as NavSection, label: 'Ujian', icon: ClipboardCheck },
            { id: 'absensi' as NavSection, label: 'Absen', icon: ScanFace },
          ].map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                  active ? 'text-teal-700 dark:text-teal-400 font-semibold' : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}
