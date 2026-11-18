import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Lock,
  Maximize2,
  Send,
  ShieldAlert,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { apiFetch, getCbtDeviceId } from '../lib/api';
import type { QuestionItem, User } from '../types';

interface CbtExamRunnerProps {
  examId: string;
  user: User;
  onExitAfterFinish: () => void;
}

interface BundleResponse {
  exam: {
    id: string;
    title: string;
    subject: string;
    durationMinutes: number;
    maxViolations: number;
    requireFullscreen: boolean;
    shuffleQuestions?: boolean;
    shuffleOptions?: boolean;
  };
  questions: QuestionItem[];
  session: {
    id: string;
    status: 'in_progress' | 'locked' | 'submitted';
    violationsCount: number;
    startedAt: string;
    submittedAt: string;
    remainingSeconds?: number;
    answers: Record<string, any>;
    totalScore: number;
  };
}

export function CbtExamRunner({ examId, user, onExitAfterFinish }: CbtExamRunnerProps) {
  const bundleCacheKey = `cbt_bundle_${examId}_${user.id}`;
  const [bundle, setBundle] = useState<BundleResponse | null>(null);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [activeIndex, setActiveIndex] = useState(0);
  const [status, setStatus] = useState<'in_progress' | 'locked' | 'submitted'>('in_progress');
  const [violationsCount, setViolationsCount] = useState(0);
  const [warningToast, setWarningToast] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncState, setSyncState] = useState<'synced' | 'pending' | 'offline_queued'>('synced');
  const [queuedCount, setQueuedCount] = useState(0);
  const [remainingSec, setRemainingSec] = useState(3600);
  const [submitting, setSubmitting] = useState(false);
  const [finalResult, setFinalResult] = useState<{ totalScore: number; autoScore: number; manualScore: number } | null>(null);
  const [loadError, setLoadError] = useState('');

  const dirtyAnswersRef = useRef<Record<string, any>>({});
  const sessionIdRef = useRef<string>('');
  const statusRef = useRef(status);
  statusRef.current = status;
  const lastViolationTsRef = useRef(0);
  const autoSubmittedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load exam bundle once and cache in localStorage
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const data = await apiFetch<BundleResponse>(`/api/cbt/exams/${examId}/bundle`, {
          headers: { 'x-cbt-device-id': getCbtDeviceId() },
        });
        if (!active) return;
        localStorage.setItem(bundleCacheKey, JSON.stringify(data));
        const localSavedRaw = localStorage.getItem(`cbt_answers_${data.session.id}`);
        const localSaved = localSavedRaw ? JSON.parse(localSavedRaw) : {};
        const merged = { ...(data.session.answers || {}), ...localSaved };

        setBundle(data);
        setAnswers(merged);
        setStatus(data.session.status);
        setViolationsCount(data.session.violationsCount);
        sessionIdRef.current = data.session.id;

        const elapsedSec = Math.floor((Date.now() - new Date(data.session.startedAt).getTime()) / 1000);
        const fallbackRem = Math.max(0, data.exam.durationMinutes * 60 - elapsedSec);
        setRemainingSec(
          typeof data.session.remainingSeconds === 'number' ? data.session.remainingSeconds : fallbackRem
        );
      } catch (err: any) {
        if (err?.status === 409 || err?.status === 403 || err?.status === 423) {
          setLoadError(err?.message || 'Akses sesi ujian ditolak.');
          return;
        }
        const cachedRaw = localStorage.getItem(bundleCacheKey);
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw) as BundleResponse;
          const localSavedRaw = localStorage.getItem(`cbt_answers_${cached.session.id}`);
          setBundle(cached);
          setAnswers(localSavedRaw ? JSON.parse(localSavedRaw) : cached.session.answers || {});
          setStatus(cached.session.status);
          sessionIdRef.current = cached.session.id;
          setIsOnline(false);
          setSyncState('offline_queued');
        } else {
          setLoadError(err?.message || 'Gagal memuat paket soal ujian.');
        }
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [examId, bundleCacheKey]);

  const enterFullscreen = useCallback(async () => {
    try {
      const target = containerRef.current || document.documentElement;
      if (!document.fullscreenElement && target.requestFullscreen) {
        await target.requestFullscreen();
      }
      setIsFullscreen(true);
    } catch {
      // Some sandboxed iframes restrict fullscreen API; allow fallback banner without crashing
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
  }, []);

  const reportViolation = useCallback(
    async (type: string, detail: string) => {
      if (statusRef.current !== 'in_progress' || !sessionIdRef.current) return;
      const now = Date.now();
      if (now - lastViolationTsRef.current < 1500) return; // debounce rapid dual events (blur + visibility)
      lastViolationTsRef.current = now;

      setWarningToast(`Pelanggaran dicatat: ${detail}`);
      setTimeout(() => setWarningToast(''), 4500);

      try {
        const res = await apiFetch<{ violationsCount: number; maxViolations: number; locked: boolean }>(
          `/api/cbt/sessions/${sessionIdRef.current}/violation`,
          {
            method: 'POST',
            body: JSON.stringify({ type, detail }),
          }
        );
        setViolationsCount(res.violationsCount);
        if (res.locked) {
          setStatus('locked');
          if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
          }
        }
      } catch {
        setViolationsCount((c) => c + 1);
      }
    },
    []
  );

  // Anti-cheat listeners (fullscreen, tab switch, blur, copy/paste, contextmenu, screenshot keys, beforeunload)
  useEffect(() => {
    if (!bundle || status !== 'in_progress') return;

    const onVisibility = () => {
      if (document.hidden) {
        reportViolation('tab_switch', 'Siswa berpindah tab atau meminimalkan browser.');
      }
    };
    const onBlur = () => {
      reportViolation('window_blur', 'Fokus jendela ujian berpindah ke aplikasi lain.');
    };
    const onFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement);
      setIsFullscreen(active);
      if (!active && bundle.exam.requireFullscreen && statusRef.current === 'in_progress') {
        reportViolation('fullscreen_exit', 'Siswa keluar dari mode layar penuh wajib.');
      }
    };
    const onCopyCutPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      reportViolation('copy_paste', `Upaya ${e.type} teks selama ujian.`);
    };
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      reportViolation('right_click', 'Klik kanan diblokir selama ujian.');
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const isScreenshot =
        e.key === 'PrintScreen' ||
        ((e.metaKey || e.ctrlKey) && e.shiftKey && ['s', 'S', '3', '4', '5'].includes(e.key));
      if (isScreenshot) {
        e.preventDefault();
        reportViolation('screenshot_attempt', 'Percobaan tangkapan layar (screenshot) terdeteksi.');
      }
      if ((e.ctrlKey || e.metaKey) && ['c', 'v', 'x', 'u', 'p'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        reportViolation('copy_paste', `Pintasan Ctrl/Cmd+${e.key.toUpperCase()} diblokir.`);
      }
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'Ujian sedang berlangsung. Anda tidak dapat keluar sebelum menyelesaikan ujian.';
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('copy', onCopyCutPaste);
    document.addEventListener('cut', onCopyCutPaste);
    document.addEventListener('paste', onCopyCutPaste);
    document.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('copy', onCopyCutPaste);
      document.removeEventListener('cut', onCopyCutPaste);
      document.removeEventListener('paste', onCopyCutPaste);
      document.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [bundle, status, reportViolation]);

  // Countdown timer
  useEffect(() => {
    if (!bundle || status !== 'in_progress') return;
    const id = setInterval(() => {
      setRemainingSec((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [bundle, status]);

  // Auto-submit when timer hits zero
  useEffect(() => {
    if (!bundle || status !== 'in_progress' || remainingSec > 0 || autoSubmittedRef.current) return;
    autoSubmittedRef.current = true;
    setWarningToast('Waktu ujian telah habis — jawaban Anda dikirim otomatis.');
    void handleFinishExam();
  }, [bundle, status, remainingSec]);

  // Poll proctor unlock when locked
  useEffect(() => {
    if (status !== 'locked' || !sessionIdRef.current) return;
    const id = setInterval(async () => {
      try {
        const res = await apiFetch<{ status: 'in_progress' | 'locked' | 'submitted'; violationsCount: number }>(
          `/api/cbt/sessions/${sessionIdRef.current}/status`
        );
        if (res.status === 'in_progress') {
          setStatus('in_progress');
          setViolationsCount(res.violationsCount);
        }
      } catch {
        /* wait next poll */
      }
    }, 3000);
    return () => clearInterval(id);
  }, [status]);

  // Batch sync answers & offline queue auto-retry
  const flushBatchSync = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || statusRef.current !== 'in_progress') return;

    const queueKey = `cbt_offline_queue_${sid}`;
    const existingQueueRaw = localStorage.getItem(queueKey);
    const existingQueue: Record<string, any> = existingQueueRaw ? JSON.parse(existingQueueRaw) : {};
    const payloadToSend = { ...existingQueue, ...dirtyAnswersRef.current };
    const keys = Object.keys(payloadToSend);
    if (keys.length === 0) return;

    dirtyAnswersRef.current = {};

    if (!navigator.onLine) {
      localStorage.setItem(queueKey, JSON.stringify(payloadToSend));
      setQueuedCount(keys.length);
      setSyncState('offline_queued');
      return;
    }

    try {
      await apiFetch(`/api/cbt/sessions/${sid}/answers-batch`, {
        method: 'POST',
        headers: { 'x-cbt-device-id': getCbtDeviceId() },
        body: JSON.stringify({ answers: payloadToSend }),
      });
      localStorage.removeItem(queueKey);
      setQueuedCount(0);
      setSyncState('synced');
    } catch (err: any) {
      if (err?.status === 423) {
        setStatus('locked');
        return;
      }
      if (err?.status === 409) {
        setLoadError(err?.message || 'Sesi ujian aktif di perangkat lain.');
        return;
      }
      localStorage.setItem(queueKey, JSON.stringify(payloadToSend));
      setQueuedCount(keys.length);
      setSyncState('offline_queued');
    }
  }, []);

  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      flushBatchSync();
    };
    const onOffline = () => {
      setIsOnline(false);
      setSyncState('offline_queued');
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const interval = setInterval(flushBatchSync, 8000);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      clearInterval(interval);
    };
  }, [flushBatchSync]);

  function updateAnswer(questionId: string, value: any) {
    if (status !== 'in_progress') return;
    setAnswers((prev) => {
      const next = { ...prev, [questionId]: value };
      if (sessionIdRef.current) {
        localStorage.setItem(`cbt_answers_${sessionIdRef.current}`, JSON.stringify(next));
      }
      return next;
    });
    dirtyAnswersRef.current[questionId] = value;
    setSyncState('pending');
  }

  async function handleFinishExam() {
    if (!bundle || !sessionIdRef.current) return;
    setSubmitting(true);
    try {
      try {
        await flushBatchSync();
      } catch {
        /* ignore batch failure on timeout; submit carries full answers map */
      }
      const res = await apiFetch<{ totalScore: number; autoScore: number; manualScore: number }>(
        `/api/cbt/sessions/${sessionIdRef.current}/submit`,
        {
          method: 'POST',
          headers: { 'x-cbt-device-id': getCbtDeviceId() },
          body: JSON.stringify({ answers }),
        }
      );
      setStatus('submitted');
      setFinalResult(res);
      localStorage.removeItem(`cbt_offline_queue_${sessionIdRef.current}`);
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    } catch (err: any) {
      setWarningToast(err?.message || 'Gagal mengirim ujian. Jawaban Anda tersimpan aman di perangkat.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-xl border border-red-200 dark:border-red-800 bg-white dark:bg-slate-900 p-6 space-y-4">
          <p className="font-display font-bold text-slate-900 dark:text-slate-100">Tidak dapat memuat ujian</p>
          <p className="text-sm text-red-700 dark:text-red-400">{loadError}</p>
          <button
            type="button"
            onClick={onExitAfterFinish}
            className="rounded-lg bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 dark:hover:bg-slate-600 px-4 py-2 text-sm font-semibold text-white cursor-pointer"
          >
            Kembali ke Portal
          </button>
        </div>
      </div>
    );
  }

  if (!bundle) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
        <div className="text-sm text-slate-600 dark:text-slate-400">Memuat paket soal ter-cache...</div>
      </div>
    );
  }

  // Submitted Screen
  if (status === 'submitted') {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
        <div className="max-w-lg w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 space-y-6 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <div className="space-y-2">
            <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">Ujian Berhasil Diselesaikan</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {bundle.exam.title} · {bundle.exam.subject}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/70 p-4 text-left">
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Nilai Akhir</p>
              <p className="font-mono text-xl font-bold text-teal-700 dark:text-teal-400 tabular-nums">
                {finalResult ? finalResult.totalScore : bundle.session.totalScore}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Skor Otomatis</p>
              <p className="font-mono text-lg font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                {finalResult ? finalResult.autoScore : '-'}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Pelanggaran</p>
              <p className="font-mono text-lg font-semibold text-slate-900 dark:text-slate-100 tabular-nums">{violationsCount}</p>
            </div>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Soal uraian/esai akan diperiksa oleh guru untuk pembaruan nilai akhir apabila belum dinilai manual.
          </p>
          <button
            type="button"
            onClick={onExitAfterFinish}
            className="w-full rounded-xl bg-teal-700 px-5 py-3 text-sm font-semibold text-white hover:bg-teal-800 cursor-pointer"
          >
            Kembali ke Beranda Siswa
          </button>
        </div>
      </div>
    );
  }

  // Locked Screen (only Pengawas can unlock!)
  if (status === 'locked') {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-red-500/40 bg-slate-900 p-8 space-y-5 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-500/20 text-red-400">
            <Lock className="h-7 w-7" />
          </div>
          <h2 className="font-display text-2xl font-bold">Ujian Dikunci Sementara</h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            Batas pelanggaran ({violationsCount}/{bundle.exam.maxViolations}) telah tercapai. Navigasi keluar dan
            pengiriman jawaban dibekukan.
          </p>
          <div className="rounded-xl border border-slate-700 bg-slate-800/70 p-4 text-xs text-slate-300 space-y-1">
            <p className="font-semibold text-white">Menunggu Pembukaan Kunci oleh Pengawas</p>
            <p>
              Laporkan kepada pengawas ruang agar membuka kunci sesi Anda melalui menu <strong>Monitor Pengawas</strong>.
              Halaman ini akan terbuka otomatis begitu pengawas mengizinkan.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const currentQ = bundle.questions[activeIndex];
  const mins = Math.floor(remainingSec / 60);
  const secs = remainingSec % 60;
  const answeredCount = bundle.questions.filter((q) => {
    const val = answers[q.id];
    if (val === undefined || val === null || val === '') return false;
    if (Array.isArray(val)) return val.length > 0;
    if (typeof val === 'object') return Object.keys(val).length > 0;
    return true;
  }).length;

  return (
    <div ref={containerRef} className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col select-none">
      {/* Mandatory Fullscreen Prompt Bar if not yet fullscreen */}
      {bundle.exam.requireFullscreen && !isFullscreen && (
        <div className="bg-amber-50 dark:bg-amber-950/60 border-b border-amber-200 dark:border-amber-800 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs sm:text-sm text-amber-900 dark:text-amber-200 font-medium">
            <Maximize2 className="h-4 w-4 text-amber-700 dark:text-amber-400 shrink-0" />
            <span>
              Mode layar penuh wajib aktif selama ujian berlangsung. Klik tombol di kanan untuk masuk layar penuh.
            </span>
          </div>
          <button
            type="button"
            onClick={enterFullscreen}
            className="rounded-lg bg-amber-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-amber-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Aktifkan Layar Penuh
          </button>
        </div>
      )}

      {/* Locked Exam Top Bar (NO home / logout allowed!) */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 truncate">
            {bundle.exam.title}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {user.name} · {user.className} · Terjawab {answeredCount}/{bundle.questions.length}
          </p>
        </div>

        <div className="flex items-center gap-3 sm:gap-4 shrink-0">
          {/* Connection & Offline Cache Indicator */}
          <div className="flex items-center gap-1.5 text-xs">
            {isOnline ? (
              <Wifi className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <WifiOff className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            )}
            <span className={syncState === 'offline_queued' ? 'text-amber-700 dark:text-amber-400 font-medium' : 'text-slate-600 dark:text-slate-300'}>
              {syncState === 'synced'
                ? 'Tersinkron'
                : syncState === 'pending'
                ? 'Menyimpan...'
                : `Antrean Luring (${queuedCount})`}
            </span>
          </div>

          {/* Violation Counter */}
          <div
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-mono tabular-nums ${
              violationsCount > 0
                ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300'
                : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
            }`}
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            <span>
              Pelanggaran {violationsCount}/{bundle.exam.maxViolations}
            </span>
          </div>

          {/* Countdown Timer */}
          <div className="flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-slate-800 border border-transparent dark:border-slate-700 text-white px-3 py-1.5 font-mono text-xs sm:text-sm font-semibold tabular-nums">
            <Clock className="h-3.5 w-3.5 text-teal-400" />
            <span>
              {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
            </span>
          </div>
        </div>
      </header>

      {warningToast && (
        <div
          role="alert"
          className="bg-red-600 text-white px-4 py-2.5 text-xs sm:text-sm font-medium flex items-center justify-center gap-2"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{warningToast}</span>
        </div>
      )}

      {/* Main Question Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Question Card */}
        <div className="lg:col-span-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">Soal {activeIndex + 1}</span>
              <span aria-hidden="true">·</span>
              <span>
                {currentQ.type === 'PG'
                  ? 'Pilihan Ganda'
                  : currentQ.type === 'PGK'
                  ? 'Pilihan Ganda Kompleks'
                  : currentQ.type === 'BS'
                  ? 'Benar / Salah'
                  : currentQ.type === 'MENJODOHKAN'
                  ? 'Menjodohkan'
                  : 'Uraian / Esai'}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">Bobot {currentQ.points} poin</span>
            </div>
          </div>

          <div className="text-base leading-relaxed text-slate-900 dark:text-slate-100 whitespace-pre-wrap">{currentQ.prompt}</div>

          {/* Render by Question Type */}
          {currentQ.type === 'PG' && (
            <div className="space-y-2.5">
              {(currentQ.options as Array<{ key: string; text: string }>).map((opt, optIdx) => {
                const selected = answers[currentQ.id] === opt.key;
                const displayLetter = bundle.exam.shuffleOptions ? String.fromCharCode(65 + optIdx) : opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => updateAnswer(currentQ.id, opt.key)}
                    className={`w-full text-left flex items-start gap-3 rounded-xl border p-3.5 transition-colors cursor-pointer ${
                      selected
                        ? 'border-teal-700 dark:border-teal-500 bg-teal-50 dark:bg-teal-950/60 text-teal-950 dark:text-teal-100'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-800/70 text-slate-800 dark:text-slate-200'
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-mono font-bold ${
                        selected ? 'bg-teal-700 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {displayLetter}
                    </span>
                    <span className="text-sm leading-relaxed">{opt.text}</span>
                  </button>
                );
              })}
            </div>
          )}

          {currentQ.type === 'PGK' && (
            <div className="space-y-2.5">
              <p className="text-xs text-slate-500 dark:text-slate-400">Pilih lebih dari satu jawaban yang benar:</p>
              {(currentQ.options as Array<{ key: string; text: string }>).map((opt, optIdx) => {
                const selectedArr: string[] = Array.isArray(answers[currentQ.id]) ? answers[currentQ.id] : [];
                const checked = selectedArr.includes(opt.key);
                const displayLetter = bundle.exam.shuffleOptions ? String.fromCharCode(65 + optIdx) : opt.key;
                return (
                  <label
                    key={opt.key}
                    className={`flex items-start gap-3 rounded-xl border p-3.5 cursor-pointer transition-colors ${
                      checked
                        ? 'border-teal-700 dark:border-teal-500 bg-teal-50 dark:bg-teal-950/60'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-800/70'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...selectedArr, opt.key]
                          : selectedArr.filter((k) => k !== opt.key);
                        updateAnswer(currentQ.id, next);
                      }}
                      className="mt-1 rounded border-slate-300 dark:border-slate-600 text-teal-700"
                    />
                    <span className="text-sm text-slate-800 dark:text-slate-200">
                      <strong className="font-mono mr-1.5">{displayLetter}.</strong>
                      {opt.text}
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          {currentQ.type === 'BS' && (
            <div className="space-y-3">
              {(Array.isArray(currentQ.options?.statements)
                ? (currentQ.options.statements as string[])
                : ['Pernyataan']
              ).map((stmt, sIdx) => {
                const curArr: string[] = Array.isArray(answers[currentQ.id]) ? answers[currentQ.id] : [];
                const val = curArr[sIdx] || '';
                return (
                  <div
                    key={sIdx}
                    className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/60 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <p className="text-sm text-slate-800 dark:text-slate-200">{stmt}</p>
                    <div className="flex items-center gap-2 shrink-0">
                      {['Benar', 'Salah'].map((choice) => (
                        <button
                          key={choice}
                          type="button"
                          onClick={() => {
                            const next = [...curArr];
                            next[sIdx] = choice;
                            updateAnswer(currentQ.id, next);
                          }}
                          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${
                            val === choice
                              ? 'border-teal-700 bg-teal-700 text-white'
                              : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                          }`}
                        >
                          {choice}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {currentQ.type === 'MENJODOHKAN' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500 dark:text-slate-400">Pilih pasangan yang tepat untuk setiap premis di kiri:</p>
              {((currentQ.options?.left as string[]) || []).map((leftItem) => {
                const mapVal: Record<string, string> =
                  answers[currentQ.id] && typeof answers[currentQ.id] === 'object' ? answers[currentQ.id] : {};
                return (
                  <div
                    key={leftItem}
                    className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/60 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{leftItem}</span>
                    <select
                      value={mapVal[leftItem] || ''}
                      onChange={(e) => {
                        updateAnswer(currentQ.id, { ...mapVal, [leftItem]: e.target.value });
                      }}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 sm:w-64"
                    >
                      <option value="">-- Pilih Pasangan --</option>
                      {((currentQ.options?.right as string[]) || []).map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          )}

          {currentQ.type === 'URAIAN' && (
            <div className="space-y-2">
              <textarea
                rows={6}
                value={typeof answers[currentQ.id] === 'string' ? answers[currentQ.id] : ''}
                onChange={(e) => updateAnswer(currentQ.id, e.target.value)}
                placeholder="Tuliskan jawaban lengkap Anda di sini..."
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 p-3.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15"
              />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Jawaban disimpan otomatis secara lokal dan dikirim berkelompok ke server.
              </p>
            </div>
          )}

          {/* Prev / Next */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              disabled={activeIndex === 0}
              onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
              className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
            >
              Sebelumnya
            </button>
            {activeIndex < bundle.questions.length - 1 ? (
              <button
                type="button"
                onClick={() => setActiveIndex((i) => Math.min(bundle.questions.length - 1, i + 1))}
                className="rounded-lg bg-slate-900 dark:bg-slate-700 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 dark:hover:bg-slate-600 cursor-pointer"
              >
                Berikutnya
              </button>
            ) : (
              <button
                type="button"
                disabled={submitting}
                onClick={handleFinishExam}
                className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60 cursor-pointer"
              >
                <Send className="h-4 w-4" />
                <span>{submitting ? 'Mengirim...' : 'Selesaikan & Kumpulkan'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Question Navigation Grid */}
        <aside className="lg:col-span-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-5">
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">Navigasi Nomor Soal</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Anda tidak dapat keluar ke beranda atau logout sebelum menekan Selesaikan Ujian.
            </p>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {bundle.questions.map((q, idx) => {
              const val = answers[q.id];
              const isAnswered =
                val !== undefined &&
                val !== null &&
                val !== '' &&
                (!Array.isArray(val) || val.length > 0) &&
                (typeof val !== 'object' || Object.keys(val).length > 0);
              const isCurrent = idx === activeIndex;
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => setActiveIndex(idx)}
                  className={`h-10 rounded-lg font-mono text-sm font-semibold border transition-colors cursor-pointer ${
                    isCurrent
                      ? 'border-slate-900 dark:border-teal-400 bg-slate-900 dark:bg-teal-600 text-white'
                      : isAnswered
                      ? 'border-teal-600 dark:border-teal-500 bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
            <button
              type="button"
              disabled={submitting}
              onClick={handleFinishExam}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60 cursor-pointer"
            >
              <Send className="h-4 w-4" />
              <span>{submitting ? 'Mengirim Jawaban...' : 'Selesaikan Ujian'}</span>
            </button>
          </div>
        </aside>
      </main>
    </div>
  );
}
