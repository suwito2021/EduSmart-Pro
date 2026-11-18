import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Eye, EyeOff, Lock, Moon, Sun, User as UserIcon, ArrowRight, ShieldAlert } from 'lucide-react';
import { apiFetch, setStoredToken } from '../lib/api';
import { useTheme } from '../lib/theme';
import type { LoginSlide, User } from '../types';
import { AnimatedPetalMotif, PetalLogo } from './PetalLogo';

interface LoginPageProps {
  onLoginSuccess: (user: User) => void;
}

const QUICK_ACCOUNTS = [
  { label: 'Admin', username: 'admin', pass: 'admin123' },
  { label: 'Guru (Bu Siti)', username: 'guru1', pass: 'guru123' },
  { label: 'Guru 2 (Pak Budi)', username: 'guru2', pass: 'guru123' },
  { label: 'Pengawas CBT', username: 'pengawas', pass: 'pengawas123' },
  { label: 'Wali Kelas', username: 'walikelas', pass: 'wali123' },
  { label: 'Siswa (Rizky)', username: '2024001', pass: 'siswa123' },
  { label: 'Alumni (Lulus)', username: '2021001', pass: 'siswa123' },
];

export function LoginPage({ onLoginSuccess }: LoginPageProps) {
  const { theme, toggleTheme } = useTheme();
  const [slides, setSlides] = useState<LoginSlide[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [username, setUsername] = useState('2024001');
  const [password, setPassword] = useState('siswa123');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch<LoginSlide[]>('/api/slides')
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) setSlides(data);
      })
      .catch(() => {
        /* fallback handled in UI */
      });
  }, []);

  useEffect(() => {
    if (slides.length <= 1) return;
    const id = setInterval(() => {
      setActiveIdx((prev) => (prev + 1) % slides.length);
    }, 6000);
    return () => clearInterval(id);
  }, [slides.length]);

  const currentSlide = slides[activeIdx] || {
    id: 'default',
    title: 'Asesmen Digital Berintegritas Tinggi',
    subtitle: 'Platform E-Learning, CBT layar penuh, presensi wajah, dan rapor Kurikulum Merdeka dalam satu ekosistem sekolah.',
    tag: 'Portal Akademik',
    image_url: '/src/assets/images/slide_cbt_campus_1794936322664.jpg',
    accent_color: '#0F766E',
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch<{ token: string; user: User }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setStoredToken(res.token);
      onLoginSuccess(res.user);
    } catch (err: any) {
      setError(err?.message || 'Gagal masuk ke sistem.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen w-full bg-slate-50 dark:bg-slate-950 flex flex-col lg:flex-row items-stretch">
      {/* Left: Animated Petal Motif + Admin-Configurable Slider */}
      <section className="relative lg:w-[58%] min-h-[340px] lg:min-h-screen overflow-hidden bg-slate-900 flex flex-col justify-between p-8 lg:p-14 text-white">
        {slides.length > 0 ? (
          slides.map((sl, idx) => (
            <div
              key={sl.id}
              className={`absolute inset-0 transition-opacity duration-700 ease-out ${
                idx === activeIdx ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
            >
              <img
                src={sl.image_url}
                alt={sl.title}
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-900/55 to-slate-950/40" />
            </div>
          ))
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-teal-900 via-slate-900 to-slate-950" />
        )}

        {/* Animated geometric petal motif derived from logo */}
        <AnimatedPetalMotif />

        {/* Brand Lockup */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/95 shadow-sm">
            <PetalLogo size={28} />
          </div>
          <div>
            <p className="font-display text-lg font-bold tracking-tight text-white">Lentera Eduka</p>
            <p className="text-xs text-slate-300">SMA Negeri Terpadu · Portal E-Learning &amp; CBT</p>
          </div>
        </div>

        {/* Active Slide Content */}
        <div className="relative z-10 max-w-xl space-y-4 my-8 lg:my-0">
          <div className="flex items-center gap-2 text-xs font-medium tracking-wide text-teal-200">
            <span>{currentSlide.tag || 'Informasi Akademik'}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {String(activeIdx + 1).padStart(2, '0')} / {String(Math.max(1, slides.length)).padStart(2, '0')}
            </span>
          </div>
          <h1 className="font-display text-2xl sm:text-4xl font-bold leading-tight text-white">
            {currentSlide.title}
          </h1>
          <p className="text-sm sm:text-base leading-relaxed text-slate-200">
            {currentSlide.subtitle}
          </p>
        </div>

        {/* Slider Controls */}
        <div className="relative z-10 flex items-center justify-between pt-4 border-t border-white/15">
          <div className="flex items-center gap-2">
            {(slides.length > 0 ? slides : [currentSlide]).map((s, idx) => (
              <button
                key={s.id}
                type="button"
                aria-label={`Slide ${idx + 1}`}
                onClick={() => setActiveIdx(idx)}
                className={`h-2 rounded-full transition-all duration-200 cursor-pointer ${
                  idx === activeIdx ? 'w-8 bg-teal-400' : 'w-2 bg-white/40 hover:bg-white/65'
                }`}
              />
            ))}
          </div>
          {slides.length > 1 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveIdx((prev) => (prev - 1 + slides.length) % slides.length)}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/25 bg-slate-900/40 text-white hover:bg-white/15 transition-colors cursor-pointer"
                aria-label="Slide sebelumnya"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setActiveIdx((prev) => (prev + 1) % slides.length)}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/25 bg-slate-900/40 text-white hover:bg-white/15 transition-colors cursor-pointer"
                aria-label="Slide berikutnya"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Right: Login Panel */}
      <section className="lg:w-[42%] relative flex flex-col justify-center px-6 py-10 sm:px-12 lg:px-16 bg-white dark:bg-slate-900">
        <div className="flex justify-end mb-6 lg:mb-0 lg:absolute lg:top-6 lg:right-8">
          <button
            type="button"
            onClick={toggleTheme}
            aria-pressed={theme === 'dark'}
            aria-label={theme === 'dark' ? 'Beralih ke mode terang' : 'Beralih ke mode gelap'}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {theme === 'dark' ? <Sun className="h-3.5 w-3.5 text-amber-400" /> : <Moon className="h-3.5 w-3.5" />}
            <span>{theme === 'dark' ? 'Mode Terang' : 'Mode Gelap'}</span>
          </button>
        </div>

        <div className="mx-auto w-full max-w-md space-y-8">
          <div className="space-y-2">
            <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Masuk ke Akun Sekolah
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Gunakan NISN untuk siswa atau NIP/Username untuk guru, pengawas, wali kelas, dan admin.
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 px-4 py-3 text-sm text-red-800 dark:text-red-300"
            >
              <ShieldAlert className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <label htmlFor="login-username" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                NISN / NIP / Username
              </label>
              <div className="relative">
                <UserIcon className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-slate-500" />
                <input
                  id="login-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Contoh: 2024001 atau guru1"
                  required
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-950 pl-10 pr-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-teal-600 focus:bg-white dark:focus:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-teal-600/15"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="login-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                Kata Sandi
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-slate-500" />
                <input
                  id="login-password"
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-950 pl-10 pr-11 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:border-teal-600 focus:bg-white dark:focus:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-teal-600/15"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                  aria-label="Tampilkan kata sandi"
                >
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-teal-700 px-5 py-3 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60 transition-colors cursor-pointer"
            >
              <span>{loading ? 'Memverifikasi akun...' : 'Masuk ke Portal'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          {/* Quick Role Switcher for Evaluation */}
          <div className="pt-6 border-t border-slate-200 dark:border-slate-800 space-y-3">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Isi Cepat Akun Uji Peran (Klik untuk mengisi kredensial)
            </p>
            <div className="flex flex-wrap gap-2">
              {QUICK_ACCOUNTS.map((acc) => {
                const isSelected = username === acc.username;
                return (
                  <button
                    key={acc.username}
                    type="button"
                    onClick={() => {
                      setUsername(acc.username);
                      setPassword(acc.pass);
                      setError('');
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      isSelected
                        ? 'border-teal-700 dark:border-teal-500 bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                  >
                    {acc.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
