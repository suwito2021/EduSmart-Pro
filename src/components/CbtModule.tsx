import React, { useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  Check,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  KeyRound,
  Lock,
  Pencil,
  Play,
  Plus,
  Power,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  Unlock,
} from 'lucide-react';
import { apiFetch, downloadAuthorizedFile } from '../lib/api';
import type { QuestionItem, QuestionType, User } from '../types';

interface CbtModuleProps {
  user: User;
  onStartExam: (examId: string) => void;
}

type TeacherTab = 'banks' | 'ai' | 'exams' | 'analysis' | 'proctor';

export function CbtModule({ user, onStartExam }: CbtModuleProps) {
  const isStudent = user.role === 'siswa';
  const isProctorOnly = user.role === 'pengawas';
  const [tab, setTab] = useState<TeacherTab>(isProctorOnly ? 'proctor' : 'exams');

  // Shared Exams State
  const [exams, setExams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Teacher Banks State
  const [banks, setBanks] = useState<any[]>([]);
  const [selectedBankId, setSelectedBankId] = useState('');
  const [bankQuestions, setBankQuestions] = useState<QuestionItem[]>([]);
  const [bankSearch, setBankSearch] = useState('');
  const [bankTypeFilter, setBankTypeFilter] = useState<'ALL' | QuestionType>('ALL');
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [newBank, setNewBank] = useState({ title: '', subject: 'Matematika Wajib', gradeLevel: 'XII-IPA-1' });
  const [newQ, setNewQ] = useState<{
    type: QuestionType;
    prompt: string;
    points: number;
    pgOptions: Array<{ key: string; text: string }>;
    pgKey: string;
    pgkKeys: string[];
    bsStatements: string[];
    bsKeys: string[];
    matchLeft: string[];
    matchRight: string[];
    matchMap: Record<string, string>;
    essayRubric: string;
    essayModel: string;
  }>({
    type: 'PG',
    prompt: '',
    points: 10,
    pgOptions: [
      { key: 'A', text: '' },
      { key: 'B', text: '' },
      { key: 'C', text: '' },
      { key: 'D', text: '' },
      { key: 'E', text: '' },
    ],
    pgKey: 'A',
    pgkKeys: ['A', 'B'],
    bsStatements: ['Pernyataan 1', 'Pernyataan 2'],
    bsKeys: ['Benar', 'Salah'],
    matchLeft: ['Premis 1', 'Premis 2'],
    matchRight: ['Pasangan 1', 'Pasangan 2', 'Pengecoh'],
    matchMap: { 'Premis 1': 'Pasangan 1', 'Premis 2': 'Pasangan 2' },
    essayRubric: '',
    essayModel: '',
  });

  // AI Generator State
  const [aiKeysInfo, setAiKeysInfo] = useState<{
    builtInGeminiAvailable: boolean;
    savedProviders: Array<{ provider: string; model_name: string; masked_key: string }>;
  }>({ builtInGeminiAvailable: true, savedProviders: [] });
  const [keyForm, setKeyForm] = useState({ provider: 'claude', apiKey: '', modelName: '' });
  const [showKeyVault, setShowKeyVault] = useState(false);
  const [aiForm, setAiForm] = useState({
    provider: 'gemini' as 'gemini' | 'claude' | 'openai' | 'openrouter',
    subject: 'Matematika Wajib',
    gradeLevel: 'XII-IPA-1',
    topic: 'Aplikasi Turunan Fungsi & Nilai Maksimum-Minimum',
    questionTypes: ['PG', 'PGK', 'BS', 'MENJODOHKAN', 'URAIAN'] as QuestionType[],
    count: 5,
    difficulty: 'Campuran' as 'Mudah' | 'Sedang' | 'Sukar' | 'Campuran',
    additionalInstructions: '',
  });
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDrafts, setAiDrafts] = useState<Array<QuestionItem & { selected: boolean }>>([]);
  const [targetBankForAi, setTargetBankForAi] = useState('');

  // Exam Creation & Submissions Grading
  const [newExam, setNewExam] = useState({
    title: '',
    subject: 'Matematika Wajib',
    classNames: 'XII-IPA-1',
    durationMinutes: 60,
    maxViolations: 3,
    requireFullscreen: true,
    shuffleQuestions: false,
    shuffleOptions: false,
    startAt: '',
    endAt: '',
    selectedQuestionIds: [] as string[],
  });
  const [submissionsView, setSubmissionsView] = useState<{
    exam: any;
    questions: QuestionItem[];
    sessions: any[];
  } | null>(null);
  const [essayInputs, setEssayInputs] = useState<Record<string, Record<string, { score: number; note: string }>>>({});

  // 1000-Student Stress Test
  const [stressResult, setStressResult] = useState<any | null>(null);
  const [stressLoading, setStressLoading] = useState(false);

  // Item Analysis
  const [selectedAnalysisExamId, setSelectedAnalysisExamId] = useState('');
  const [analysisReport, setAnalysisReport] = useState<any | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  // Proctor Monitor
  const [proctorExamFilter, setProctorExamFilter] = useState('');
  const [proctorData, setProctorData] = useState<{ sessions: any[]; violations: any[] }>({
    sessions: [],
    violations: [],
  });

  async function loadExams() {
    setLoading(true);
    try {
      const data = await apiFetch<any[]>('/api/cbt/exams');
      setExams(data);
      if (data.length > 0 && !selectedAnalysisExamId) {
        const analyzed = data.find((e) => e.id === 'ex-mat-latihan') || data[0];
        setSelectedAnalysisExamId(analyzed.id);
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadBanks() {
    if (isStudent || isProctorOnly) return;
    const data = await apiFetch<any[]>('/api/banks');
    setBanks(data);
    if (data.length > 0) {
      const bId = selectedBankId || data[0].id;
      setSelectedBankId(bId);
      setTargetBankForAi((prev) => prev || bId);
      loadBankQuestions(bId);
    }
  }

  async function loadBankQuestions(bankId: string) {
    if (!bankId) return;
    try {
      const data = await apiFetch<{ questions: QuestionItem[] }>(`/api/banks/${bankId}/questions`);
      setBankQuestions(data.questions);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal membuka bank soal.');
    }
  }

  async function loadAiKeys() {
    if (isStudent || isProctorOnly) return;
    const data = await apiFetch<any>('/api/ai/keys');
    setAiKeysInfo(data);
  }

  async function loadProctor(examIdOverride?: string) {
    const targetExam = examIdOverride !== undefined ? examIdOverride : proctorExamFilter;
    const qs = targetExam ? `?examId=${encodeURIComponent(targetExam)}` : '';
    const data = await apiFetch<{ sessions: any[]; violations: any[] }>(`/api/cbt/proctor/sessions${qs}`);
    setProctorData(data);
  }

  useEffect(() => {
    loadExams();
    if (!isStudent && !isProctorOnly) {
      loadBanks();
      loadAiKeys();
    }
    if (isProctorOnly || user.role === 'admin' || user.role === 'guru' || user.role === 'wali_kelas') {
      loadProctor();
    }
  }, [user.id]);

  // Poll Proctor every 4s when on proctor tab
  useEffect(() => {
    if (tab !== 'proctor') return;
    loadProctor();
    const id = setInterval(() => loadProctor(), 4000);
    return () => clearInterval(id);
  }, [tab, proctorExamFilter]);

  // Load Item Analysis when tab === 'analysis'
  useEffect(() => {
    if (tab !== 'analysis' || !selectedAnalysisExamId) return;
    setAnalysisLoading(true);
    apiFetch(`/api/cbt/exams/${selectedAnalysisExamId}/analysis`)
      .then(setAnalysisReport)
      .catch(() => setAnalysisReport(null))
      .finally(() => setAnalysisLoading(false));
  }, [tab, selectedAnalysisExamId]);

  async function handleCreateBank(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    const res = await apiFetch<{ id: string }>('/api/banks', {
      method: 'POST',
      body: JSON.stringify(newBank),
    });
    setNewBank({ title: '', subject: newBank.subject, gradeLevel: newBank.gradeLevel });
    setSelectedBankId(res.id);
    await loadBanks();
    setNotice('Bank soal baru berhasil dibuat.');
  }

  function startEditQuestion(q: QuestionItem) {
    const defaultPg = ['A', 'B', 'C', 'D', 'E'].map((key, i) => ({
      key,
      text: Array.isArray(q.options) && q.options[i] ? String(q.options[i].text || '') : '',
    }));
    const bsStatements =
      q.type === 'BS' && Array.isArray(q.options?.statements)
        ? q.options.statements
        : ['Pernyataan 1', 'Pernyataan 2'];
    const bsKeys = q.type === 'BS' && Array.isArray(q.answerKey) ? q.answerKey : ['Benar', 'Salah'];
    const matchLeft =
      q.type === 'MENJODOHKAN' && Array.isArray(q.options?.left) ? q.options.left : ['Premis 1', 'Premis 2'];
    const matchRight =
      q.type === 'MENJODOHKAN' && Array.isArray(q.options?.right)
        ? q.options.right
        : ['Pasangan 1', 'Pasangan 2', 'Pengecoh'];
    const matchMap =
      q.type === 'MENJODOHKAN' && q.answerKey && typeof q.answerKey === 'object' ? q.answerKey : {};

    setEditingQuestionId(q.id);
    setNewQ({
      type: q.type,
      prompt: q.prompt,
      points: Number(q.points) || 10,
      pgOptions: defaultPg,
      pgKey: q.type === 'PG' ? String(q.answerKey || 'A') : 'A',
      pgkKeys: q.type === 'PGK' && Array.isArray(q.answerKey) ? q.answerKey : ['A', 'B'],
      bsStatements,
      bsKeys,
      matchLeft,
      matchRight,
      matchMap,
      essayRubric: q.type === 'URAIAN' ? String(q.options?.rubric || '') : '',
      essayModel: q.type === 'URAIAN' ? String(q.answerKey?.modelAnswer || '') : '',
    });
  }

  function cancelEditQuestion() {
    setEditingQuestionId(null);
    setNewQ((prev) => ({
      ...prev,
      prompt: '',
      pgOptions: ['A', 'B', 'C', 'D', 'E'].map((key) => ({ key, text: '' })),
      essayRubric: '',
      essayModel: '',
    }));
  }

  async function handleAddManualQuestion(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedBankId) return;
    setErrorMsg('');
    let options: any = [];
    let answerKey: any = '';
    if (newQ.type === 'PG') {
      options = newQ.pgOptions;
      answerKey = newQ.pgKey;
    } else if (newQ.type === 'PGK') {
      options = newQ.pgOptions;
      answerKey = newQ.pgkKeys;
    } else if (newQ.type === 'BS') {
      options = { statements: newQ.bsStatements };
      answerKey = newQ.bsKeys;
    } else if (newQ.type === 'MENJODOHKAN') {
      options = { left: newQ.matchLeft, right: newQ.matchRight };
      answerKey = newQ.matchMap;
    } else {
      options = { rubric: newQ.essayRubric, maxWords: 250 };
      answerKey = { modelAnswer: newQ.essayModel, keywords: [] };
    }

    try {
      if (editingQuestionId) {
        await apiFetch(`/api/questions/${editingQuestionId}`, {
          method: 'PUT',
          body: JSON.stringify({
            type: newQ.type,
            prompt: newQ.prompt,
            options,
            answerKey,
            points: newQ.points,
          }),
        });
        setEditingQuestionId(null);
        setNotice('Perubahan butir soal berhasil disimpan.');
      } else {
        await apiFetch(`/api/banks/${selectedBankId}/questions`, {
          method: 'POST',
          body: JSON.stringify({
            questions: [
              {
                type: newQ.type,
                prompt: newQ.prompt,
                options,
                answerKey,
                points: newQ.points,
              },
            ],
          }),
        });
        setNotice('Butir soal ditambahkan ke bank soal Anda.');
      }
      setNewQ((prev) => ({ ...prev, prompt: '' }));
      loadBankQuestions(selectedBankId);
      loadBanks();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal menyimpan butir soal.');
    }
  }

  async function handleSaveEncryptedKey(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    try {
      await apiFetch('/api/ai/keys', {
        method: 'POST',
        body: JSON.stringify(keyForm),
      });
      setKeyForm({ ...keyForm, apiKey: '' });
      await loadAiKeys();
      setNotice(`API Key ${keyForm.provider.toUpperCase()} disimpan terenkripsi AES-256-GCM di server.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal menyimpan kunci API.');
    }
  }

  async function handleGenerateAiQuestions(e: React.FormEvent) {
    e.preventDefault();
    setAiLoading(true);
    setErrorMsg('');
    try {
      const res = await apiFetch<{ questions: QuestionItem[]; providerUsed: string; modelUsed: string }>(
        '/api/ai/generate-questions',
        {
          method: 'POST',
          body: JSON.stringify(aiForm),
        }
      );
      setAiDrafts(res.questions.map((q, idx) => ({ ...q, id: `draft-${idx}`, selected: true })));
      setNotice(
        `Berhasil menyusun ${res.questions.length} draf soal menggunakan ${res.providerUsed} (${res.modelUsed}). Periksa hasil sebelum menyimpan.`
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal menghasilkan soal AI.');
    } finally {
      setAiLoading(false);
    }
  }

  async function handleCommitAiDrafts() {
    const selected = aiDrafts.filter((d) => d.selected);
    if (!targetBankForAi || selected.length === 0) return;
    await apiFetch(`/api/banks/${targetBankForAi}/questions`, {
      method: 'POST',
      body: JSON.stringify({ questions: selected }),
    });
    setAiDrafts([]);
    loadBanks();
    loadBankQuestions(targetBankForAi);
    setNotice(`${selected.length} soal terverifikasi berhasil disimpan ke Bank Soal Anda.`);
  }

  async function handleCreateExam(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    try {
      await apiFetch('/api/cbt/exams', {
        method: 'POST',
        body: JSON.stringify({
          title: newExam.title,
          subject: newExam.subject,
          classNames: newExam.classNames.split(',').map((s) => s.trim()).filter(Boolean),
          durationMinutes: newExam.durationMinutes,
          maxViolations: newExam.maxViolations,
          requireFullscreen: newExam.requireFullscreen,
          shuffleQuestions: newExam.shuffleQuestions,
          shuffleOptions: newExam.shuffleOptions,
          startAt: newExam.startAt || undefined,
          endAt: newExam.endAt || undefined,
          questionIds:
            newExam.selectedQuestionIds.length > 0
              ? newExam.selectedQuestionIds
              : bankQuestions.map((q) => q.id),
        }),
      });
      setNewExam({
        ...newExam,
        title: '',
        startAt: '',
        endAt: '',
        selectedQuestionIds: [],
      });
      await loadExams();
      setNotice('Ujian CBT baru diterbitkan dan paket soal di-cache di server.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal membuat ujian.');
    }
  }

  async function toggleExamStatus(exam: any) {
    const nextStatus = exam.status === 'active' ? 'closed' : 'active';
    try {
      await apiFetch(`/api/cbt/exams/${exam.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      await loadExams();
      setNotice(`Ujian "${exam.title}" kini ${nextStatus === 'active' ? 'Aktif' : 'Ditutup'}.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal mengubah status ujian.');
    }
  }

  async function openSubmissions(examId: string) {
    const data = await apiFetch<any>(`/api/cbt/exams/${examId}/submissions`);
    setSubmissionsView(data);
    const initial: Record<string, Record<string, { score: number; note: string }>> = {};
    for (const s of data.sessions) {
      initial[s.id] = s.essayGrades || {};
    }
    setEssayInputs(initial);
  }

  async function saveEssayGrade(sessionId: string) {
    await apiFetch(`/api/cbt/sessions/${sessionId}/grade-essay`, {
      method: 'POST',
      body: JSON.stringify({ essayGrades: essayInputs[sessionId] || {} }),
    });
    if (submissionsView) {
      await openSubmissions(submissionsView.exam.id);
    }
    setNotice('Nilai esai & total skor siswa diperbarui.');
  }

  async function runStressTest(examId: string) {
    setStressLoading(true);
    try {
      const res = await apiFetch(`/api/cbt/exams/${examId}/stress-test`, { method: 'POST' });
      setStressResult(res);
    } finally {
      setStressLoading(false);
    }
  }

  async function unlockSession(sessionId: string) {
    await apiFetch(`/api/cbt/proctor/sessions/${sessionId}/unlock`, { method: 'POST' });
    setNotice('Kunci ujian siswa berhasil dibuka oleh pengawas.');
    loadProctor();
  }

  async function forceSubmitSession(sessionId: string, studentName: string) {
    try {
      const res = await apiFetch<{ totalScore: number }>(`/api/cbt/proctor/sessions/${sessionId}/force-submit`, {
        method: 'POST',
      });
      setNotice(`Sesi ujian ${studentName} diselesaikan paksa (Nilai akhir: ${res.totalScore}).`);
      loadProctor();
      loadExams();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal menyelesaikan sesi secara paksa.');
    }
  }

  // ============================================================================
  // STUDENT CBT LIST VIEW
  // ============================================================================
  if (isStudent) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">Ujian CBT Aman</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Ujian mewajibkan mode layar penuh. Paket soal di-cache ke perangkat agar ringan dan aman jika koneksi terputus.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {loading ? (
            <div className="h-36 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse" />
          ) : exams.length === 0 ? (
            <div className="md:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              Belum ada jadwal ujian CBT untuk kelas {user.className}.
            </div>
          ) : (
            exams.map((ex) => {
              const sess = ex.session;
              const isDone = sess?.status === 'submitted';
              const isLocked = sess?.status === 'locked';
              return (
                <div
                  key={ex.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between gap-4"
                >
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span>{ex.subject}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{ex.durationMinutes} menit</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{ex.questionCount} soal</span>
                    </div>
                    <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">{ex.title}</h3>
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      Guru: {ex.ownerName} · Batas pelanggaran: {ex.maxViolations}x
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
                    {isDone ? (
                      <div className="text-xs">
                        <span className="text-emerald-700 dark:text-emerald-400 font-semibold">Selesai</span>
                        <span className="mx-1.5 text-slate-300 dark:text-slate-600">·</span>
                        <span className="font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                          Nilai {sess.totalScore}
                        </span>
                      </div>
                    ) : isLocked ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 dark:text-red-400">
                        <Lock className="h-3.5 w-3.5" />
                        Terkunci ({sess.violationsCount} pelanggaran)
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-teal-700 dark:text-teal-400">
                        {ex.status === 'active' ? 'Siap Dikerjakan' : 'Ditutup'}
                      </span>
                    )}

                    {!isDone && ex.status === 'active' && (
                      <button
                        type="button"
                        onClick={() => onStartExam(ex.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 cursor-pointer"
                      >
                        <Play className="h-3.5 w-3.5" />
                        <span>{sess ? 'Lanjutkan Ujian' : 'Mulai Ujian'}</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  // ============================================================================
  // TEACHER / PROCTOR / ADMIN CBT WORKSPACE
  // ============================================================================
  const tabs: Array<{ id: TeacherTab; label: string }> = isProctorOnly
    ? [{ id: 'proctor', label: 'Monitor Pengawas' }]
    : [
        { id: 'exams', label: 'Ujian & Penilaian' },
        { id: 'banks', label: 'Bank Soal Saya' },
        { id: 'ai', label: 'Pembuat Soal AI' },
        { id: 'analysis', label: 'Analisis Butir & Excel' },
        { id: 'proctor', label: 'Monitor Pengawas' },
      ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">Manajemen CBT &amp; Analisis Soal</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Bank soal terisolasi per guru, generator soal AI multi-provider, koreksi otomatis &amp; esai, serta analisis butir soal.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                tab === t.id
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {notice && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 px-4 py-3 text-xs sm:text-sm text-emerald-800 dark:text-emerald-300 flex items-center justify-between">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} className="text-emerald-700 dark:text-emerald-400 font-semibold cursor-pointer">
            Tutup
          </button>
        </div>
      )}
      {errorMsg && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 px-4 py-3 text-xs sm:text-sm text-red-800 dark:text-red-300 flex items-center justify-between">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg('')} className="text-red-700 dark:text-red-400 font-semibold cursor-pointer">
            Tutup
          </button>
        </div>
      )}

      {/* TAB: BANK SOAL SAYA (Isolated per Teacher) */}
      {tab === 'banks' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-4 space-y-4">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
              <div>
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">Bank Soal Pribadi Anda</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Terisolasi penuh: guru lain tidak dapat membuka atau melihat isi bank soal milik Anda.
                </p>
              </div>
              <div className="space-y-2">
                {banks.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => {
                      setSelectedBankId(b.id);
                      loadBankQuestions(b.id);
                    }}
                    className={`w-full text-left rounded-lg border p-3 transition-colors cursor-pointer ${
                      selectedBankId === b.id
                        ? 'border-teal-700 dark:border-teal-500 bg-teal-50/70 dark:bg-teal-950/50'
                        : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{b.title}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {b.subject} · {b.grade_level} · <span className="font-mono tabular-nums">{b.question_count}</span> soal
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={handleCreateBank} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <h4 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">Buat Bank Soal Baru</h4>
              <input
                type="text"
                required
                placeholder="Judul Bank Soal"
                value={newBank.title}
                onChange={(e) => setNewBank({ ...newBank, title: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  required
                  placeholder="Mapel"
                  value={newBank.subject}
                  onChange={(e) => setNewBank({ ...newBank, subject: e.target.value })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                />
                <input
                  type="text"
                  required
                  placeholder="Kelas"
                  value={newBank.gradeLevel}
                  onChange={(e) => setNewBank({ ...newBank, gradeLevel: e.target.value })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                />
              </div>
              <button
                type="submit"
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 dark:bg-slate-700 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-slate-600 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Buat Bank Soal</span>
              </button>
            </form>
          </div>

          <div className="lg:col-span-8 space-y-6">
            {/* Manual Question Editor for All 5 Types */}
            <form onSubmit={handleAddManualQuestion} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  {editingQuestionId ? 'Sunting Butir Soal' : 'Tambah Butir Soal (5 Tipe Soal)'}
                </h3>
                <div className="flex items-center gap-2">
                  <select
                    value={newQ.type}
                    onChange={(e) => setNewQ({ ...newQ, type: e.target.value as QuestionType })}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                  >
                    <option value="PG">Pilihan Ganda (PG)</option>
                    <option value="PGK">PG Kompleks (PGK)</option>
                    <option value="BS">Benar / Salah (BS)</option>
                    <option value="MENJODOHKAN">Menjodohkan</option>
                    <option value="URAIAN">Uraian / Esai</option>
                  </select>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={newQ.points}
                    onChange={(e) => setNewQ({ ...newQ, points: Number(e.target.value) })}
                    className="w-20 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-mono tabular-nums text-slate-900 dark:text-slate-100"
                    title="Bobot Poin"
                  />
                </div>
              </div>

              <textarea
                rows={2}
                required
                placeholder="Tulis pertanyaan atau stimulus soal..."
                value={newQ.prompt}
                onChange={(e) => setNewQ({ ...newQ, prompt: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
              />

              {(newQ.type === 'PG' || newQ.type === 'PGK') && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {newQ.pgOptions.map((o, idx) => (
                    <div key={o.key} className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-slate-600 dark:text-slate-400 w-5">{o.key}.</span>
                      <input
                        type="text"
                        value={o.text}
                        onChange={(e) => {
                          const next = [...newQ.pgOptions];
                          next[idx] = { ...o, text: e.target.value };
                          setNewQ({ ...newQ, pgOptions: next });
                        }}
                        placeholder={`Opsi ${o.key}`}
                        className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                      />
                    </div>
                  ))}
                  {newQ.type === 'PG' ? (
                    <div className="sm:col-span-2 flex items-center gap-2 text-xs">
                      <span className="font-medium text-slate-700 dark:text-slate-300">Kunci Jawaban:</span>
                      <select
                        value={newQ.pgKey}
                        onChange={(e) => setNewQ({ ...newQ, pgKey: e.target.value })}
                        className="rounded border border-slate-200 dark:border-slate-700 px-2 py-1 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                      >
                        {['A', 'B', 'C', 'D', 'E'].map((k) => (
                          <option key={k} value={k}>{k}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="sm:col-span-2 flex items-center gap-3 text-xs text-slate-700 dark:text-slate-300">
                      <span className="font-medium text-slate-700 dark:text-slate-300">Kunci Jawaban (multi):</span>
                      {['A', 'B', 'C', 'D', 'E'].map((k) => (
                        <label key={k} className="inline-flex items-center gap-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newQ.pgkKeys.includes(k)}
                            onChange={(e) =>
                              setNewQ({
                                ...newQ,
                                pgkKeys: e.target.checked
                                  ? [...newQ.pgkKeys, k]
                                  : newQ.pgkKeys.filter((x) => x !== k),
                              })
                            }
                          />
                          <span>{k}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {newQ.type === 'BS' && (
                <div className="space-y-2 text-xs">
                  {newQ.bsStatements.map((st, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={st}
                        onChange={(e) => {
                          const next = [...newQ.bsStatements];
                          next[idx] = e.target.value;
                          setNewQ({ ...newQ, bsStatements: next });
                        }}
                        className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-slate-900 dark:text-slate-100"
                      />
                      <select
                        value={newQ.bsKeys[idx]}
                        onChange={(e) => {
                          const next = [...newQ.bsKeys];
                          next[idx] = e.target.value;
                          setNewQ({ ...newQ, bsKeys: next });
                        }}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1.5 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                      >
                        <option value="Benar">Benar</option>
                        <option value="Salah">Salah</option>
                      </select>
                    </div>
                  ))}
                </div>
              )}

              {newQ.type === 'MENJODOHKAN' && (
                <div className="space-y-2 text-xs">
                  <p className="text-slate-500 dark:text-slate-400">Isi premis kiri &amp; pasangan kanannya (pisahkan koma untuk daftar kanan):</p>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={newQ.matchLeft.join(', ')}
                      onChange={(e) => {
                        const arr = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                        setNewQ({ ...newQ, matchLeft: arr });
                      }}
                      placeholder="Premis kiri (pisahkan koma)"
                      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                    />
                    <input
                      type="text"
                      value={newQ.matchRight.join(', ')}
                      onChange={(e) => {
                        const arr = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                        const map: Record<string, string> = {};
                        newQ.matchLeft.forEach((l, i) => {
                          map[l] = arr[i] || arr[0] || '';
                        });
                        setNewQ({ ...newQ, matchRight: arr, matchMap: map });
                      }}
                      placeholder="Pasangan kanan (pisahkan koma)"
                      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                    />
                  </div>
                </div>
              )}

              {newQ.type === 'URAIAN' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Rubrik penilaian uraian"
                    value={newQ.essayRubric}
                    onChange={(e) => setNewQ({ ...newQ, essayRubric: e.target.value })}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                  />
                  <input
                    type="text"
                    placeholder="Kunci jawaban acuan"
                    value={newQ.essayModel}
                    onChange={(e) => setNewQ({ ...newQ, essayModel: e.target.value })}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                  />
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>{editingQuestionId ? 'Simpan Perubahan' : 'Simpan Butir Soal'}</span>
                </button>
                {editingQuestionId && (
                  <button
                    type="button"
                    onClick={cancelEditQuestion}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    Batal Edit
                  </button>
                )}
              </div>
            </form>

            {/* Questions List in Selected Bank */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
              <div className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
                <span className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  Daftar Butir Soal ({bankQuestions.length})
                </span>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500 absolute left-2.5 top-2.5" />
                    <input
                      type="text"
                      placeholder="Cari soal..."
                      value={bankSearch}
                      onChange={(e) => setBankSearch(e.target.value)}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 pl-8 pr-3 py-1.5 text-xs w-44 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                    />
                  </div>
                  <select
                    value={bankTypeFilter}
                    onChange={(e) => setBankTypeFilter(e.target.value as any)}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                  >
                    <option value="ALL">Semua Tipe</option>
                    <option value="PG">PG</option>
                    <option value="PGK">PGK</option>
                    <option value="BS">BS</option>
                    <option value="MENJODOHKAN">Menjodohkan</option>
                    <option value="URAIAN">Uraian</option>
                  </select>
                </div>
              </div>
              {bankQuestions
                .filter((q) => {
                  const matchType = bankTypeFilter === 'ALL' || q.type === bankTypeFilter;
                  const matchQuery =
                    !bankSearch.trim() || q.prompt.toLowerCase().includes(bankSearch.trim().toLowerCase());
                  return matchType && matchQuery;
                })
                .map((q, idx) => (
                <div key={q.id} className="p-5 flex items-start justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">#{idx + 1}</span>
                      <span>·</span>
                      <span className="font-semibold text-teal-700 dark:text-teal-400">{q.type}</span>
                      <span>·</span>
                      <span className="font-mono tabular-nums">{q.points} poin</span>
                    </div>
                    <p className="text-sm text-slate-900 dark:text-slate-100">{q.prompt}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Kunci: <span className="font-mono text-slate-700 dark:text-slate-300">{JSON.stringify(q.answerKey)}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => startEditQuestion(q)}
                      className="text-slate-600 dark:text-slate-400 hover:text-teal-700 dark:hover:text-teal-400 p-1.5 cursor-pointer"
                      aria-label="Edit soal"
                      title="Sunting soal"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await apiFetch(`/api/questions/${q.id}`, { method: 'DELETE' });
                        if (editingQuestionId === q.id) cancelEditQuestion();
                        loadBankQuestions(selectedBankId);
                        loadBanks();
                      }}
                      className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 p-1.5 cursor-pointer"
                      aria-label="Hapus soal"
                      title="Hapus soal"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB: PEMBUAT SOAL AI (Multi-provider + Encrypted API Key Vault + Preview Before Save) */}
      {tab === 'ai' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                  Pembuat Soal AI (5 Tipe Soal Sekaligus)
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Mendukung Gemini, Claude, OpenAI, dan OpenRouter. Kunci API pihak ketiga disimpan terenkripsi AES-256-GCM di server, dan hasil wajib diperiksa guru sebelum disimpan.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowKeyVault((v) => !v)}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
              >
                <KeyRound className="h-4 w-4 text-teal-700 dark:text-teal-400" />
                <span>Pengaturan Kunci API Terenkripsi</span>
              </button>
            </div>

            {showKeyVault && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">Status Provider Tersedia:</span>
                  <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                    Gemini Bawaan Server: {aiKeysInfo.builtInGeminiAvailable ? 'Aktif Terhubung' : 'Belum Diatur'}
                  </span>
                </div>
                {aiKeysInfo.savedProviders.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {aiKeysInfo.savedProviders.map((p) => (
                      <div
                        key={p.provider}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 flex items-center justify-between text-xs"
                      >
                        <div>
                          <p className="font-semibold uppercase text-slate-900 dark:text-slate-100">{p.provider}</p>
                          <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{p.masked_key} (AES-256)</p>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/api/ai/keys/${p.provider}`, { method: 'DELETE' });
                            loadAiKeys();
                          }}
                          className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 cursor-pointer"
                        >
                          Hapus
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <form onSubmit={handleSaveEncryptedKey} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Provider</label>
                    <select
                      value={keyForm.provider}
                      onChange={(e) => setKeyForm({ ...keyForm, provider: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                    >
                      <option value="claude">Claude (Anthropic)</option>
                      <option value="openai">OpenAI</option>
                      <option value="openrouter">OpenRouter</option>
                      <option value="gemini">Gemini (Kustom)</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">API Key (Dienkripsi di Server)</label>
                    <input
                      type="password"
                      required
                      placeholder="sk-ant-... / sk-... / sk-or-..."
                      value={keyForm.apiKey}
                      onChange={(e) => setKeyForm({ ...keyForm, apiKey: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                    />
                  </div>
                  <button
                    type="submit"
                    className="rounded-lg bg-slate-900 dark:bg-slate-700 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-slate-600 cursor-pointer"
                  >
                    Enkripsi &amp; Simpan
                  </button>
                </form>
              </div>
            )}

            <form onSubmit={handleGenerateAiQuestions} className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Mesin AI</label>
                <select
                  value={aiForm.provider}
                  onChange={(e) => setAiForm({ ...aiForm, provider: e.target.value as any })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                >
                  <option value="gemini">Google Gemini (Siap Pakai)</option>
                  <option value="claude">Anthropic Claude (Kunci Terenkripsi)</option>
                  <option value="openai">OpenAI GPT (Kunci Terenkripsi)</option>
                  <option value="openrouter">OpenRouter (Kunci Terenkripsi)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Mata Pelajaran</label>
                <input
                  type="text"
                  required
                  value={aiForm.subject}
                  onChange={(e) => setAiForm({ ...aiForm, subject: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Jumlah Butir &amp; Kesulitan</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={1}
                    max={15}
                    value={aiForm.count}
                    onChange={(e) => setAiForm({ ...aiForm, count: Number(e.target.value) })}
                    className="w-20 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-slate-100"
                  />
                  <select
                    value={aiForm.difficulty}
                    onChange={(e) => setAiForm({ ...aiForm, difficulty: e.target.value as any })}
                    className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                  >
                    <option value="Campuran">Campuran</option>
                    <option value="Mudah">Mudah</option>
                    <option value="Sedang">Sedang</option>
                    <option value="Sukar">Sukar</option>
                  </select>
                </div>
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Topik / Tujuan Pembelajaran</label>
                <input
                  type="text"
                  required
                  value={aiForm.topic}
                  onChange={(e) => setAiForm({ ...aiForm, topic: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Kelas / Fase</label>
                <input
                  type="text"
                  value={aiForm.gradeLevel}
                  onChange={(e) => setAiForm({ ...aiForm, gradeLevel: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="md:col-span-3 flex flex-wrap items-center justify-between gap-4 pt-1">
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-700 dark:text-slate-300">
                  <span className="font-medium text-slate-700 dark:text-slate-300">Tipe Soal:</span>
                  {(['PG', 'PGK', 'BS', 'MENJODOHKAN', 'URAIAN'] as QuestionType[]).map((qt) => (
                    <label key={qt} className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={aiForm.questionTypes.includes(qt)}
                        onChange={(e) =>
                          setAiForm({
                            ...aiForm,
                            questionTypes: e.target.checked
                              ? [...aiForm.questionTypes, qt]
                              : aiForm.questionTypes.filter((x) => x !== qt),
                          })
                        }
                      />
                      <span>{qt}</span>
                    </label>
                  ))}
                </div>
                <button
                  type="submit"
                  disabled={aiLoading}
                  className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60 cursor-pointer"
                >
                  <Sparkles className="h-4 w-4" />
                  <span>{aiLoading ? 'Menyusun Soal AI...' : 'Buat Draf Soal'}</span>
                </button>
              </div>
            </form>
          </div>

          {/* Teacher Review & Edit Staging Area Before Saving */}
          {aiDrafts.length > 0 && (
            <div className="rounded-xl border border-teal-200 dark:border-teal-800 bg-white dark:bg-slate-900 p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
                <div>
                  <h4 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                    Pratinjau &amp; Pemeriksaan Guru ({aiDrafts.filter((d) => d.selected).length}/{aiDrafts.length} dipilih)
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Sunting redaksi soal, bobot poin, atau hapus butir yang kurang sesuai sebelum menyimpannya ke Bank Soal.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={targetBankForAi}
                    onChange={(e) => setTargetBankForAi(e.target.value)}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                  >
                    {banks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.title}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleCommitAiDrafts}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 cursor-pointer"
                  >
                    <Check className="h-4 w-4" />
                    <span>Simpan Terpilih ke Bank Soal</span>
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                {aiDrafts.map((d, idx) => (
                  <div key={d.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={d.selected}
                          onChange={(e) =>
                            setAiDrafts((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, selected: e.target.checked } : x))
                            )
                          }
                        />
                        <span>Butir #{idx + 1} · {d.type} · {d.difficultyTarget}</span>
                      </label>
                      <input
                        type="number"
                        value={d.points}
                        onChange={(e) =>
                          setAiDrafts((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, points: Number(e.target.value) } : x))
                          )
                        }
                        className="w-20 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-xs font-mono tabular-nums text-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <textarea
                      rows={2}
                      value={d.prompt}
                      onChange={(e) =>
                        setAiDrafts((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, prompt: e.target.value } : x))
                        )
                      }
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                    />
                    <div className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/70 rounded-lg p-3 space-y-1">
                      <p>
                        <strong>Opsi / Struktur:</strong> <span className="font-mono">{JSON.stringify(d.options)}</span>
                      </p>
                      <p>
                        <strong>Kunci Jawaban:</strong> <span className="font-mono text-teal-800 dark:text-teal-300">{JSON.stringify(d.answerKey)}</span>
                      </p>
                      <p>
                        <strong>Pembahasan:</strong> {d.explanation}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB: UJIAN & PENILAIAN + UJI BEBAN 1000 SISWA */}
      {tab === 'exams' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <form onSubmit={handleCreateExam} className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">Terbitkan Ujian CBT Baru</h3>
              <input
                type="text"
                required
                placeholder="Judul Ujian (mis. PAS Matematika XII)"
                value={newExam.title}
                onChange={(e) => setNewExam({ ...newExam, title: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  required
                  placeholder="Mata Pelajaran"
                  value={newExam.subject}
                  onChange={(e) => setNewExam({ ...newExam, subject: e.target.value })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                />
                <input
                  type="text"
                  required
                  placeholder="Kelas (pisahkan koma)"
                  value={newExam.classNames}
                  onChange={(e) => setNewExam({ ...newExam, classNames: e.target.value })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <label className="block text-slate-600 dark:text-slate-400 mb-1">Durasi (menit)</label>
                  <input
                    type="number"
                    min={5}
                    value={newExam.durationMinutes}
                    onChange={(e) => setNewExam({ ...newExam, durationMinutes: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 font-mono tabular-nums text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 dark:text-slate-400 mb-1">Maks Pelanggaran Kunci</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={newExam.maxViolations}
                    onChange={(e) => setNewExam({ ...newExam, maxViolations: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 font-mono tabular-nums text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <label className="block text-slate-600 dark:text-slate-400 mb-1">Mulai Ujian (Opsional)</label>
                  <input
                    type="datetime-local"
                    value={newExam.startAt}
                    onChange={(e) => setNewExam({ ...newExam, startAt: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 font-mono text-[11px] text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 dark:text-slate-400 mb-1">Batas Akhir (Opsional)</label>
                  <input
                    type="datetime-local"
                    value={newExam.endAt}
                    onChange={(e) => setNewExam({ ...newExam, endAt: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 font-mono text-[11px] text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-4 text-xs text-slate-700 dark:text-slate-300 pt-1">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newExam.shuffleQuestions}
                    onChange={(e) => setNewExam({ ...newExam, shuffleQuestions: e.target.checked })}
                  />
                  <span>Acak Urutan Soal</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newExam.shuffleOptions}
                    onChange={(e) => setNewExam({ ...newExam, shuffleOptions: e.target.checked })}
                  />
                  <span>Acak Opsi PG/PGK</span>
                </label>
              </div>

              <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    Pilih Soal ({newExam.selectedQuestionIds.length > 0 ? newExam.selectedQuestionIds.length : bankQuestions.length}/{bankQuestions.length})
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setNewExam({ ...newExam, selectedQuestionIds: bankQuestions.map((q) => q.id) })}
                      className="text-teal-700 dark:text-teal-400 font-semibold hover:underline cursor-pointer"
                    >
                      Semua
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewExam({ ...newExam, selectedQuestionIds: [] })}
                      className="text-slate-600 dark:text-slate-400 font-medium hover:underline cursor-pointer"
                    >
                      Bawaan Semua
                    </button>
                  </div>
                </div>
                {bankQuestions.length > 0 && (
                  <div className="max-h-36 overflow-y-auto divide-y divide-slate-200/70 dark:divide-slate-700/70 bg-white dark:bg-slate-950 rounded border border-slate-200 dark:border-slate-700 px-2.5">
                    {bankQuestions.map((q, idx) => {
                      const checked = newExam.selectedQuestionIds.includes(q.id);
                      return (
                        <label key={q.id} className="flex items-start gap-2 py-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              setNewExam({
                                ...newExam,
                                selectedQuestionIds: e.target.checked
                                  ? [...newExam.selectedQuestionIds, q.id]
                                  : newExam.selectedQuestionIds.filter((id) => id !== q.id),
                              })
                            }
                            className="mt-0.5"
                          />
                          <span className="text-[11px] text-slate-700 dark:text-slate-300 line-clamp-1">
                            #{idx + 1} [{q.type}] {q.prompt}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <button
                type="submit"
                className="w-full rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 cursor-pointer"
              >
                Terbitkan Ujian &amp; Cache Paket Soal
              </button>
            </form>

            <div className="lg:col-span-7 space-y-4">
              {exams.map((ex) => (
                <div key={ex.id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {ex.subject} · Kelas {(ex.classNames || []).join(', ')} · Maks Pelanggaran {ex.max_violations}x
                        {ex.shuffleQuestions ? ' · Acak Soal' : ''}
                        {ex.shuffleOptions ? ' · Acak Opsi' : ''}
                        {' · '}
                        <span className={ex.status === 'active' ? 'font-semibold text-emerald-700 dark:text-emerald-400' : 'font-semibold text-slate-600 dark:text-slate-400'}>
                          {ex.status === 'active' ? 'Aktif' : 'Ditutup'}
                        </span>
                      </p>
                      <h4 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">{ex.title}</h4>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openSubmissions(ex.id)}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Periksa &amp; Nilai Uraian
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          downloadAuthorizedFile(
                            `/api/cbt/exams/${ex.id}/results/export`,
                            `hasil-cbt-${ex.id}.xlsx`
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span>Nilai (.xlsx)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleExamStatus(ex)}
                        className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer ${
                          ex.status === 'active'
                            ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50'
                            : 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50'
                        }`}
                      >
                        <Power className="h-3.5 w-3.5" />
                        <span>{ex.status === 'active' ? 'Tutup Ujian' : 'Aktifkan'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedAnalysisExamId(ex.id);
                          setTab('analysis');
                        }}
                        className="rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/50 px-3 py-1.5 text-xs font-semibold text-teal-800 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/50 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Analisis Butir
                      </button>
                      <button
                        type="button"
                        disabled={stressLoading}
                        onClick={() => runStressTest(ex.id)}
                        className="inline-flex items-center gap-1 rounded-lg bg-slate-900 dark:bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-slate-600 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Activity className="h-3.5 w-3.5" />
                        <span>Uji 1000 Siswa</span>
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums pt-2 border-t border-slate-100 dark:border-slate-800">
                    <span>Peserta: {ex.stats?.total || 0}</span>
                    <span>Selesai: {ex.stats?.submitted || 0}</span>
                    <span className={(ex.stats?.locked || 0) > 0 ? 'text-red-700 dark:text-red-400 font-semibold' : ''}>
                      Terkunci: {ex.stats?.locked || 0}
                    </span>
                  </div>
                </div>
              ))}

              {stressResult && (
                <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/50 p-5 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-display text-sm font-bold text-emerald-950 dark:text-emerald-200">
                      Hasil Uji Konkurensi 1.000 Siswa Bersamaan
                    </h4>
                    <span className="font-mono text-xs font-bold text-emerald-800 dark:text-emerald-300">
                      {stressResult.successCount}/{stressResult.totalStudents} Sukses · {stressResult.errorCount} Error
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs pt-2">
                    <div>
                      <p className="text-emerald-800 dark:text-emerald-300">Ukuran Bundle Cache</p>
                      <p className="font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">{stressResult.bundlePayloadBytes} B</p>
                    </div>
                    <div>
                      <p className="text-emerald-800 dark:text-emerald-300">1000x Baca Cache</p>
                      <p className="font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">{stressResult.readPhaseMs} ms</p>
                    </div>
                    <div>
                      <p className="text-emerald-800 dark:text-emerald-300">1000x Commit Batch WAL</p>
                      <p className="font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">{stressResult.batchCommitMs} ms</p>
                    </div>
                    <div>
                      <p className="text-emerald-800 dark:text-emerald-300">Throughput Server</p>
                      <p className="font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">{stressResult.throughputReqPerSec} req/dtk</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Essay & Auto-Score Grading Drawer */}
          {submissionsView && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <h4 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                    Hasil &amp; Penilaian Manual Esai: {submissionsView.exam.title}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    PG, PGK, BS, dan Menjodohkan dihitung otomatis. Masukkan skor manual soal Uraian lalu klik Simpan Nilai.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      downloadAuthorizedFile(
                        `/api/cbt/exams/${submissionsView.exam.id}/results/export`,
                        `hasil-cbt-${submissionsView.exam.id}.xlsx`
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Ekspor Nilai (.xlsx)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSubmissionsView(null)}
                    className="text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                  >
                    Tutup Panel
                  </button>
                </div>
              </div>

              <div className="space-y-4 max-h-[520px] overflow-y-auto pr-1">
                {submissionsView.sessions.map((s) => {
                  const essayQs = submissionsView.questions.filter((q) => q.type === 'URAIAN');
                  return (
                    <div key={s.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{s.student_name}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Status: {s.status} · Otomatis: <span className="font-mono">{s.auto_score}</span> · Manual:{' '}
                            <span className="font-mono">{s.manual_score}</span>
                          </p>
                        </div>
                        <div className="font-mono text-base font-bold text-teal-700 dark:text-teal-400 tabular-nums">
                          Total: {s.total_score}
                        </div>
                      </div>

                      {essayQs.map((eq) => {
                        const current = essayInputs[s.id]?.[eq.id] || { score: 0, note: '' };
                        return (
                          <div key={eq.id} className="rounded-lg bg-slate-50 dark:bg-slate-800/70 p-3 space-y-2 text-xs">
                            <p className="font-semibold text-slate-800 dark:text-slate-200">Uraian: {eq.prompt}</p>
                            <p className="text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-950 rounded border border-slate-200 dark:border-slate-700 p-2">
                              Jawaban Siswa: {s.answers?.[eq.id] || '(Kosong)'}
                            </p>
                            <div className="flex flex-wrap items-center gap-3 text-slate-700 dark:text-slate-300">
                              <label className="flex items-center gap-1.5">
                                <span>Skor (maks {eq.points}):</span>
                                <input
                                  type="number"
                                  min={0}
                                  max={eq.points}
                                  value={current.score}
                                  onChange={(e) =>
                                    setEssayInputs((prev) => ({
                                      ...prev,
                                      [s.id]: {
                                        ...(prev[s.id] || {}),
                                        [eq.id]: { ...current, score: Number(e.target.value) },
                                      },
                                    }))
                                  }
                                  className="w-20 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 font-mono tabular-nums text-slate-900 dark:text-slate-100"
                                />
                              </label>
                              <input
                                type="text"
                                placeholder="Catatan koreksi guru"
                                value={current.note || ''}
                                onChange={(e) =>
                                  setEssayInputs((prev) => ({
                                    ...prev,
                                    [s.id]: {
                                      ...(prev[s.id] || {}),
                                      [eq.id]: { ...current, note: e.target.value },
                                    },
                                  }))
                                }
                                className="flex-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                              />
                              <button
                                type="button"
                                onClick={() => saveEssayGrade(s.id)}
                                className="rounded-lg bg-teal-700 px-3 py-1.5 font-semibold text-white hover:bg-teal-800 cursor-pointer"
                              >
                                Simpan Nilai
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB: ANALISIS BUTIR SOAL & EKSPOR EXCEL */}
      {tab === 'analysis' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <BarChart3 className="h-5 w-5 text-teal-700 dark:text-teal-400" />
              <select
                value={selectedAnalysisExamId}
                onChange={(e) => setSelectedAnalysisExamId(e.target.value)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-medium text-slate-900 dark:text-slate-100"
              >
                {exams.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {ex.title} ({ex.stats?.submitted || 0} selesai)
                  </option>
                ))}
              </select>
            </div>
            {selectedAnalysisExamId && (
              <button
                type="button"
                onClick={() =>
                  downloadAuthorizedFile(
                    `/api/cbt/exams/${selectedAnalysisExamId}/analysis/export`,
                    `analisis-butir-${selectedAnalysisExamId}.xlsx`
                  )
                }
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
              >
                <FileSpreadsheet className="h-4 w-4" />
                <span>Ekspor Analisis ke Excel (.xlsx)</span>
              </button>
            )}
          </div>

          {analysisLoading ? (
            <div className="h-48 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse" />
          ) : analysisReport ? (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Reliabilitas Instrumen (KR-20 / α)</p>
                  <p className="font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-1">
                    {analysisReport.reliabilityAlpha}
                  </p>
                  <p className="text-xs font-medium text-teal-700 dark:text-teal-400 mt-0.5">{analysisReport.reliabilityCategory}</p>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Peserta Dianalisis</p>
                  <p className="font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-1">
                    {analysisReport.respondentCount}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{analysisReport.questionCount} butir soal</p>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Rata-rata &amp; Simpangan Baku</p>
                  <p className="font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-1">
                    {analysisReport.meanTotalScore}
                  </p>
                  <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-0.5">SD {analysisReport.stdDevTotalScore}</p>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Rentang Nilai (Min–Maks)</p>
                  <p className="font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-1">
                    {analysisReport.lowestScore} – {analysisReport.highestScore}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Skala 100</p>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-xs font-semibold text-slate-600 dark:text-slate-400">
                      <th className="py-3 px-4">No</th>
                      <th className="py-3 px-4">Tipe &amp; Cuplikan</th>
                      <th className="py-3 px-4 text-right">Kesukaran (P)</th>
                      <th className="py-3 px-4 text-right">Daya Pembeda (D)</th>
                      <th className="py-3 px-4 text-right">Validitas (r_xy)</th>
                      <th className="py-3 px-4">Rekomendasi</th>
                      <th className="py-3 px-4">Sebaran Jawaban &amp; Pengecoh</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                    {analysisReport.items.map((it: any) => (
                      <tr key={it.questionId} className="align-top hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                        <td className="py-3.5 px-4 font-mono font-bold text-slate-900 dark:text-slate-100">{it.number}</td>
                        <td className="py-3.5 px-4 max-w-xs">
                          <p className="font-semibold text-teal-800 dark:text-teal-400">{it.type}</p>
                          <p className="text-slate-600 dark:text-slate-300 mt-0.5">{it.promptPreview}</p>
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">{it.difficultyIndex}</p>
                          <p className="text-slate-500 dark:text-slate-400">{it.difficultyCategory}</p>
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">{it.discriminationIndex}</p>
                          <p className="text-slate-500 dark:text-slate-400">{it.discriminationCategory}</p>
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">{it.validityRxy}</p>
                          <p className={it.validityStatus === 'Valid' ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>
                            {it.validityStatus}
                          </p>
                        </td>
                        <td className="py-3.5 px-4">
                          <p
                            className={`font-semibold ${
                              it.recommendation === 'Diterima'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : it.recommendation === 'Revisi'
                                ? 'text-amber-700 dark:text-amber-400'
                                : 'text-red-700 dark:text-red-400'
                            }`}
                          >
                            {it.recommendation}
                          </p>
                          <p className="text-slate-500 dark:text-slate-400 mt-0.5 max-w-[180px]">{it.recommendationReason}</p>
                        </td>
                        <td className="py-3.5 px-4 min-w-[240px] space-y-1.5">
                          {it.answerDistribution.map((ad: any) => (
                            <div key={ad.label} className="space-y-0.5">
                              <div className="flex justify-between text-[11px] text-slate-600 dark:text-slate-400">
                                <span>{ad.label}</span>
                                <span className="font-mono tabular-nums">
                                  {ad.count} ({ad.pct}%)
                                </span>
                              </div>
                              <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                <div
                                  className="h-full bg-teal-600 dark:bg-teal-500 rounded-full"
                                  style={{ width: `${Math.min(100, ad.pct)}%` }}
                                />
                              </div>
                            </div>
                          ))}
                          {it.distractors.length > 0 && (
                            <div className="pt-1 text-[11px] text-slate-500 dark:text-slate-400">
                              {it.distractors
                                .filter((d: any) => !d.isCorrect)
                                .map((d: any) => `${d.optionKey}: ${d.effectiveness}`)
                                .join(' · ')}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              Belum ada peserta yang menyelesaikan ujian ini untuk dianalisis.
            </div>
          )}
        </div>
      )}

      {/* TAB: MONITOR PENGAWAS (Real-time Violation & Unlock) */}
      {tab === 'proctor' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">Status Peserta Ujian</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Peserta yang melebihi batas pelanggaran otomatis dikunci dan hanya dapat dibuka oleh pengawas.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={proctorExamFilter}
                  onChange={(e) => {
                    const val = e.target.value;
                    setProctorExamFilter(val);
                    void loadProctor(val);
                  }}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                >
                  <option value="">Semua Ujian</option>
                  {exams.map((ex) => (
                    <option key={ex.id} value={ex.id}>
                      {ex.title}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => loadProctor()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Segarkan</span>
                </button>
              </div>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {proctorData.sessions.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">Belum ada sesi ujian aktif.</p>
              ) : (
                proctorData.sessions.map((s) => (
                  <div key={s.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {s.student_name} <span className="text-xs font-normal text-slate-500 dark:text-slate-400">· {s.class_name}</span>
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {s.exam_title} · Pelanggaran:{' '}
                        <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                          {s.violations_count}/{s.max_violations}
                        </span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {s.status === 'locked' ? (
                        <>
                          <button
                            type="button"
                            onClick={() => unlockSession(s.id)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-red-700 whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <Unlock className="h-3.5 w-3.5" />
                            <span>Buka Kunci</span>
                          </button>
                          {(user.role === 'pengawas' || user.role === 'admin') && (
                            <button
                              type="button"
                              onClick={() => forceSubmitSession(s.id, s.student_name)}
                              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              Paksa Selesai
                            </button>
                          )}
                        </>
                      ) : s.status === 'submitted' ? (
                        <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Selesai ({s.total_score})
                        </span>
                      ) : (
                        <>
                          <span className="text-xs font-medium text-teal-700 dark:text-teal-400">Sedang Mengerjakan</span>
                          {(user.role === 'pengawas' || user.role === 'admin') && (
                            <button
                              type="button"
                              onClick={() => forceSubmitSession(s.id, s.student_name)}
                              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              Paksa Selesai
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">Log Pelanggaran Real-Time</h3>
            <div className="space-y-2.5 max-h-[460px] overflow-y-auto">
              {proctorData.violations.map((v) => (
                <div key={v.id} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                      <ShieldAlert className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
                      {v.student_name}
                    </span>
                    <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      {new Date(v.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-slate-700 dark:text-slate-300">{v.detail}</p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">Jenis: {v.type}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
