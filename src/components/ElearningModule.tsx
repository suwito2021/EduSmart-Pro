import React, { useEffect, useState } from 'react';
import {
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Eye,
  Paperclip,
  Plus,
  Search,
  Send,
  Trash2,
  Upload,
} from 'lucide-react';
import { apiFetch, uploadFileToServer } from '../lib/api';
import type { MaterialBlock, User } from '../types';
import { OnlineMeetingsSection } from './OnlineMeetingsSection';

interface ElearningModuleProps {
  user: User;
  initialSubTab?: 'materi' | 'tugas' | 'meet' | 'jadwal';
}

function getYoutubeEmbedUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.hostname.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return `https://www.youtube.com/embed/${v}`;
    }
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.replace('/', '');
      if (id) return `https://www.youtube.com/embed/${id}`;
    }
    if (u.hostname.includes('drive.google.com')) {
      return raw.replace('/view', '/preview');
    }
  } catch {
    /* ignore */
  }
  return raw;
}

export function ElearningModule({ user, initialSubTab = 'materi' }: ElearningModuleProps) {
  const isStudent = user.role === 'siswa';
  const isAdmin = user.role === 'admin';
  const [subTab, setSubTab] = useState<'materi' | 'tugas' | 'meet' | 'jadwal'>(initialSubTab);

  const [materials, setMaterials] = useState<any[]>([]);
  const [activeMaterial, setActiveMaterial] = useState<any | null>(null);
  const [readersModal, setReadersModal] = useState<any | null>(null);

  const [assignments, setAssignments] = useState<any[]>([]);
  const [academic, setAcademic] = useState<{ assignments: any[]; schedules: any[]; teachers: any[] }>({
    assignments: [],
    schedules: [],
    teachers: [],
  });

  // Material Builder
  const [matForm, setMatForm] = useState({
    title: '',
    subject: 'Matematika Wajib',
    className: 'XII-IPA-1',
    summary: '',
    textBlock: '',
    arabicBlock: '',
    tableCsv: '',
    youtubeUrl: '',
    imageUrl: '',
    attachmentUrl: '',
  });

  // Assignment Builder
  const [asgForm, setAsgForm] = useState({
    title: '',
    subject: 'Matematika Wajib',
    className: 'XII-IPA-1',
    description: '',
    deadline: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 16),
    maxScore: 100,
    allowLate: true,
  });

  // Search, filter & uploads
  const [searchQuery, setSearchQuery] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('ALL');
  const [uploadingKey, setUploadingKey] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Student submission state
  const [studentSubmit, setStudentSubmit] = useState<Record<string, { answerText: string; attachmentUrl: string }>>({});
  // Teacher grading state
  const [gradeInputs, setGradeInputs] = useState<Record<string, { score: number; teacherNote: string }>>({});
  // Schedule & Pengampu forms (Admin)
  const [pengampuForm, setPengampuForm] = useState({ teacherId: '', subject: 'Matematika Wajib', className: 'XII-IPA-1' });
  const [schedForm, setSchedForm] = useState({
    className: 'XII-IPA-1',
    dayName: 'Jumat',
    startTime: '07:15',
    endTime: '08:45',
    subject: 'Matematika Wajib',
    teacherId: '',
    room: 'Ruang 12A',
  });
  const [notice, setNotice] = useState('');

  async function loadAll() {
    const [mats, asgs, acad] = await Promise.all([
      apiFetch<any[]>('/api/elearning/materials'),
      apiFetch<any[]>('/api/elearning/assignments'),
      apiFetch<any>('/api/academic/overview'),
    ]);
    setMaterials(mats);
    setAssignments(asgs);
    setAcademic(acad);
    if (acad.teachers?.length > 0 && !pengampuForm.teacherId) {
      setPengampuForm((p) => ({ ...p, teacherId: acad.teachers[0].id }));
      setSchedForm((s) => ({ ...s, teacherId: acad.teachers[0].id }));
    }
  }

  useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab]);

  useEffect(() => {
    loadAll();
  }, [user.id]);

  async function openMaterialReader(mat: any) {
    setActiveMaterial(mat);
    if (isStudent) {
      await apiFetch(`/api/elearning/materials/${mat.id}/read`, { method: 'POST' });
      loadAll();
    }
  }

  async function handleCreateMaterial(e: React.FormEvent) {
    e.preventDefault();
    const blocks: MaterialBlock[] = [];
    if (matForm.textBlock.trim()) blocks.push({ type: 'text', content: matForm.textBlock.trim() });
    if (matForm.arabicBlock.trim()) blocks.push({ type: 'arabic', content: matForm.arabicBlock.trim() });
    if (matForm.tableCsv.trim()) {
      const lines = matForm.tableCsv.trim().split('\n').map((l) => l.split('|').map((c) => c.trim()));
      if (lines.length >= 2) {
        blocks.push({ type: 'table', headers: lines[0], rows: lines.slice(1) });
      }
    }
    if (matForm.imageUrl.trim()) blocks.push({ type: 'image', url: matForm.imageUrl.trim(), caption: matForm.title });
    if (matForm.youtubeUrl.trim()) blocks.push({ type: 'youtube', url: matForm.youtubeUrl.trim(), caption: 'Video Materi' });
    if (matForm.attachmentUrl.trim()) blocks.push({ type: 'attachment', title: 'Lampiran Materi', url: matForm.attachmentUrl.trim() });

    await apiFetch('/api/elearning/materials', {
      method: 'POST',
      body: JSON.stringify({
        title: matForm.title,
        subject: matForm.subject,
        className: matForm.className,
        summary: matForm.summary,
        blocks,
      }),
    });
    setMatForm({ ...matForm, title: '', summary: '', textBlock: '', arabicBlock: '', tableCsv: '', youtubeUrl: '', imageUrl: '', attachmentUrl: '' });
    setNotice('Materi baru berhasil diterbitkan.');
    loadAll();
  }

  async function handleFileUpload(file: File | undefined, key: string, onSuccess: (url: string, origName: string) => void) {
    if (!file) return;
    setErrorMsg('');
    setUploadingKey(key);
    try {
      const res = await uploadFileToServer(file);
      onSuccess(res.url, res.originalName);
      setNotice(`Berkas "${res.originalName}" berhasil diunggah.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal mengunggah berkas.');
    } finally {
      setUploadingKey('');
    }
  }

  async function handleDeleteMaterial(materialId: string) {
    setErrorMsg('');
    try {
      await apiFetch(`/api/elearning/materials/${materialId}`, { method: 'DELETE' });
      setConfirmDeleteId('');
      setNotice('Materi berhasil dihapus.');
      loadAll();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal menghapus materi.');
    }
  }

  async function handleCreateAssignment(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    await apiFetch('/api/elearning/assignments', {
      method: 'POST',
      body: JSON.stringify(asgForm),
    });
    setAsgForm({ ...asgForm, title: '', description: '' });
    setNotice('Tugas baru berhasil dibuat dengan batas waktu.');
    loadAll();
  }

  async function handleDeleteAssignment(assignmentId: string) {
    setErrorMsg('');
    try {
      await apiFetch(`/api/elearning/assignments/${assignmentId}`, { method: 'DELETE' });
      setConfirmDeleteId('');
      setNotice('Tugas berhasil dihapus.');
      loadAll();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal menghapus tugas.');
    }
  }

  async function handleSubmitAssignment(assignmentId: string) {
    const payload = studentSubmit[assignmentId];
    if (!payload) return;
    setErrorMsg('');
    try {
      const res = await apiFetch<{ ok: boolean; isLate?: boolean }>(`/api/elearning/assignments/${assignmentId}/submit`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setNotice(res.isLate ? 'Tugas berhasil dikumpulkan (tercatat terlambat melewati tenggat).' : 'Tugas berhasil dikumpulkan tepat waktu.');
      loadAll();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal mengumpulkan tugas.');
    }
  }

  async function handleGradeSubmission(submissionId: string) {
    const g = gradeInputs[submissionId];
    if (!g) return;
    await apiFetch(`/api/elearning/submissions/${submissionId}/grade`, {
      method: 'POST',
      body: JSON.stringify(g),
    });
    setNotice('Nilai & catatan tugas disimpan.');
    loadAll();
  }

  const allSubjects = Array.from(new Set([...materials.map((m) => m.subject), ...assignments.map((a) => a.subject)])).filter(Boolean);
  const qLower = searchQuery.trim().toLowerCase();
  const filteredMaterials = materials.filter((m) => {
    const okSub = subjectFilter === 'ALL' || m.subject === subjectFilter;
    const okSearch = !qLower || String(m.title || '').toLowerCase().includes(qLower) || String(m.summary || '').toLowerCase().includes(qLower);
    return okSub && okSearch;
  });
  const filteredAssignments = assignments.filter((a) => {
    const okSub = subjectFilter === 'ALL' || a.subject === subjectFilter;
    const okSearch = !qLower || String(a.title || '').toLowerCase().includes(qLower) || String(a.description || '').toLowerCase().includes(qLower);
    return okSub && okSearch;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">E-Learning &amp; Jadwal Kelas</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Materi multimedia (teks, tabel, teks Arab, YouTube/Drive, lampiran), tugas terstruktur, tatap muka Google Meet, dan jadwal pelajaran.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg overflow-x-auto">
          {[
            { id: 'materi', label: 'Materi Belajar' },
            { id: 'tugas', label: 'Tugas & Nilai' },
            { id: 'meet', label: 'Tatap Muka Online' },
            { id: 'jadwal', label: 'Jadwal & Pengampu' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id as any)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                subTab === t.id
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
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 px-4 py-2.5 text-xs text-emerald-800 dark:text-emerald-300 flex items-center justify-between">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} className="font-semibold cursor-pointer">
            Tutup
          </button>
        </div>
      )}
      {errorMsg && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 px-4 py-2.5 text-xs text-red-800 dark:text-red-300 flex items-center justify-between">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg('')} className="font-semibold cursor-pointer">
            Tutup
          </button>
        </div>
      )}

      {(subTab === 'materi' || subTab === 'tugas') && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder={subTab === 'materi' ? 'Cari judul atau ringkasan materi...' : 'Cari judul atau instruksi tugas...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 pl-8 pr-3 py-1.5 text-xs"
            />
          </div>
          <select
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-1.5 text-xs"
          >
            <option value="ALL">Semua Mata Pelajaran</option>
            {allSubjects.map((sub) => (
              <option key={sub} value={sub}>
                {sub}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* SUBTAB 1: MATERI */}
      {subTab === 'materi' && (
        <div className="space-y-6">
          {!isStudent && (
            <form onSubmit={handleCreateMaterial} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">Buat Materi Pembelajaran Baru</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input
                  type="text"
                  required
                  placeholder="Judul Materi"
                  value={matForm.title}
                  onChange={(e) => setMatForm({ ...matForm, title: e.target.value })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 text-sm"
                />
                <input
                  type="text"
                  required
                  placeholder="Mata Pelajaran"
                  value={matForm.subject}
                  onChange={(e) => setMatForm({ ...matForm, subject: e.target.value })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 text-sm"
                />
                <select
                  value={matForm.className}
                  onChange={(e) => setMatForm({ ...matForm, className: e.target.value })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm"
                >
                  <option value="XII-IPA-1">XII-IPA-1</option>
                  <option value="XI-IPA-1">XI-IPA-1</option>
                  <option value="X-1">X-1</option>
                </select>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <textarea
                  rows={3}
                  placeholder="Isi teks materi..."
                  value={matForm.textBlock}
                  onChange={(e) => setMatForm({ ...matForm, textBlock: e.target.value })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 text-sm"
                />
                <textarea
                  rows={3}
                  dir="rtl"
                  placeholder="النص العربي (Opsional: teks Arab RTL)..."
                  value={matForm.arabicBlock}
                  onChange={(e) => setMatForm({ ...matForm, arabicBlock: e.target.value })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 text-base font-arabic"
                />
                <textarea
                  rows={2}
                  placeholder="Tabel (baris 1 header, pisahkan kolom dengan |, mis: Konsep | Rumus)"
                  value={matForm.tableCsv}
                  onChange={(e) => setMatForm({ ...matForm, tableCsv: e.target.value })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 text-xs font-mono"
                />
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="Tautan Video YouTube atau Google Drive (opsional)"
                    value={matForm.youtubeUrl}
                    onChange={(e) => setMatForm({ ...matForm, youtubeUrl: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 text-xs"
                  />
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="URL Gambar Ilustrasi atau unggah berkas →"
                      value={matForm.imageUrl}
                      onChange={(e) => setMatForm({ ...matForm, imageUrl: e.target.value })}
                      className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 text-xs"
                    />
                    <label className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap shrink-0 cursor-pointer">
                      <Upload className="h-3.5 w-3.5" />
                      <span>{uploadingKey === 'mat-img' ? 'Mengunggah...' : 'Gambar'}</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          void handleFileUpload(file, 'mat-img', (url) => setMatForm((prev) => ({ ...prev, imageUrl: url })));
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Tautan Lampiran PDF/Dokumen atau unggah →"
                      value={matForm.attachmentUrl}
                      onChange={(e) => setMatForm({ ...matForm, attachmentUrl: e.target.value })}
                      className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 text-xs"
                    />
                    <label className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap shrink-0 cursor-pointer">
                      <Paperclip className="h-3.5 w-3.5" />
                      <span>{uploadingKey === 'mat-att' ? 'Mengunggah...' : 'PDF/Dok'}</span>
                      <input
                        type="file"
                        accept=".pdf,.docx,.xlsx,.pptx,.txt,image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          void handleFileUpload(file, 'mat-att', (url) =>
                            setMatForm((prev) => ({ ...prev, attachmentUrl: url }))
                          );
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>
                </div>
              </div>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Terbitkan Materi</span>
              </button>
            </form>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredMaterials.map((m) => (
              <div key={m.id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                    <span>
                      {m.subject} · {m.class_name}
                    </span>
                    {isStudent ? (
                      <span className={m.hasRead ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-amber-700 dark:text-amber-400 font-medium'}>
                        {m.hasRead ? 'Sudah Dibaca' : 'Belum Dibaca'}
                      </span>
                    ) : (
                      <span className="font-mono tabular-nums">
                        Dibaca {m.readCount}/{m.totalStudentsInClass} siswa
                      </span>
                    )}
                  </div>
                  <h4 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">{m.title}</h4>
                  <p className="text-xs text-slate-600 dark:text-slate-400">{m.summary}</p>
                </div>
                <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-xs text-slate-500 dark:text-slate-400">{m.teacher_name}</span>
                  <div className="flex items-center gap-2">
                    {!isStudent && (isAdmin || m.teacher_id === user.id) && (
                      confirmDeleteId === m.id ? (
                        <button
                          type="button"
                          onClick={() => handleDeleteMaterial(m.id)}
                          className="rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-red-700 whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          Konfirmasi Hapus
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(m.id)}
                          className="rounded-lg border border-slate-200 dark:border-slate-700 p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 cursor-pointer"
                          aria-label="Hapus materi"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )
                    )}
                    {!isStudent && (
                      <button
                        type="button"
                        onClick={() => setReadersModal(m)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>Cek Pembaca</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openMaterialReader(m)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-slate-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-slate-600 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <BookOpen className="h-3.5 w-3.5" />
                      <span>Baca Materi</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Material Reader Modal */}
          {activeMaterial && (
            <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-slate-950/80 flex items-center justify-center p-4 overflow-y-auto">
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 max-w-3xl w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto">
                <div className="flex items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {activeMaterial.subject} · {activeMaterial.class_name} · {activeMaterial.teacher_name}
                    </p>
                    <h3 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100 mt-1">{activeMaterial.title}</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveMaterial(null)}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    Tutup
                  </button>
                </div>

                <div className="space-y-5">
                  {(activeMaterial.blocks as MaterialBlock[]).map((b, idx) => {
                    if (b.type === 'text') {
                      return (
                        <p key={idx} className="text-sm leading-relaxed text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
                          {b.content}
                        </p>
                      );
                    }
                    if (b.type === 'arabic') {
                      return (
                        <div key={idx} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-5 text-right">
                          <p dir="rtl" className="font-arabic text-2xl text-slate-900 dark:text-slate-100 leading-loose">
                            {b.content}
                          </p>
                        </div>
                      );
                    }
                    if (b.type === 'table' && b.headers && b.rows) {
                      return (
                        <div key={idx} className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead>
                              <tr className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-700 font-semibold text-slate-700 dark:text-slate-300">
                                {b.headers.map((h, hi) => (
                                  <th key={hi} className="py-2.5 px-3">
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                              {b.rows.map((r, ri) => (
                                <tr key={ri}>
                                  {r.map((cell, ci) => (
                                    <td key={ci} className="py-2.5 px-3 text-slate-800 dark:text-slate-200">
                                      {cell}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    }
                    if (b.type === 'youtube' && b.url) {
                      return (
                        <div key={idx} className="space-y-2">
                          <div className="aspect-video w-full rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-900">
                            <iframe
                              src={getYoutubeEmbedUrl(b.url)}
                              title={b.caption || 'Video Materi'}
                              className="h-full w-full"
                              allowFullScreen
                            />
                          </div>
                          {b.caption && <p className="text-xs text-slate-500 dark:text-slate-400">{b.caption}</p>}
                        </div>
                      );
                    }
                    if (b.type === 'image' && b.url) {
                      return (
                        <img
                          key={idx}
                          src={b.url}
                          alt={b.caption || 'Ilustrasi materi'}
                          referrerPolicy="no-referrer"
                          className="rounded-xl border border-slate-200 dark:border-slate-700 max-h-80 object-contain"
                        />
                      );
                    }
                    if (b.type === 'attachment' && b.url) {
                      return (
                        <a
                          key={idx}
                          href={b.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2.5 text-xs font-semibold text-teal-800 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/60"
                        >
                          <span>{b.title || 'Buka Lampiran Materi'}</span>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      );
                    }
                    return null;
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Readers Modal */}
          {readersModal && (
            <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-slate-950/80 flex items-center justify-center p-4">
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 max-w-lg w-full p-6 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div>
                    <h4 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">Siswa yang Sudah Membaca</h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{readersModal.title}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReadersModal(null)}
                    className="text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                  >
                    Tutup
                  </button>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs max-h-80 overflow-y-auto">
                  {readersModal.readers.length === 0 ? (
                    <p className="py-6 text-center text-slate-500 dark:text-slate-400">Belum ada siswa yang membaca materi ini.</p>
                  ) : (
                    readersModal.readers.map((r: any) => (
                      <div key={r.student_id} className="py-2.5 flex items-center justify-between">
                        <span className="font-medium text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                          {r.student_name} ({r.class_name})
                        </span>
                        <span className="font-mono text-slate-500 dark:text-slate-400">
                          {new Date(r.read_at).toLocaleString('id-ID')}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUBTAB 2: TUGAS & PENGUMPULAN */}
      {subTab === 'tugas' && (
        <div className="space-y-6">
          {!isStudent && (
            <form onSubmit={handleCreateAssignment} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">Buat Tugas Baru dengan Batas Waktu</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <input
                  type="text"
                  required
                  placeholder="Judul Tugas"
                  value={asgForm.title}
                  onChange={(e) => setAsgForm({ ...asgForm, title: e.target.value })}
                  className="md:col-span-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                />
                <input
                  type="text"
                  required
                  placeholder="Mapel"
                  value={asgForm.subject}
                  onChange={(e) => setAsgForm({ ...asgForm, subject: e.target.value })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                />
                <select
                  value={asgForm.className}
                  onChange={(e) => setAsgForm({ ...asgForm, className: e.target.value })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                >
                  <option value="XII-IPA-1">XII-IPA-1</option>
                  <option value="XI-IPA-1">XI-IPA-1</option>
                  <option value="X-1">X-1</option>
                </select>
              </div>
              <textarea
                rows={2}
                required
                placeholder="Instruksi pengerjaan tugas..."
                value={asgForm.description}
                onChange={(e) => setAsgForm({ ...asgForm, description: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-4 text-xs text-slate-700 dark:text-slate-300">
                  <div className="flex items-center gap-2">
                    <span>Batas Waktu:</span>
                    <input
                      type="datetime-local"
                      required
                      value={asgForm.deadline}
                      onChange={(e) => setAsgForm({ ...asgForm, deadline: e.target.value })}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 font-mono text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <label className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={asgForm.allowLate}
                      onChange={(e) => setAsgForm({ ...asgForm, allowLate: e.target.checked })}
                    />
                    <span>Izinkan pengumpulan terlambat</span>
                  </label>
                </div>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <ClipboardList className="h-3.5 w-3.5" />
                  <span>Terbitkan Tugas</span>
                </button>
              </div>
            </form>
          )}

          <div className="space-y-4">
            {filteredAssignments.map((a) => {
              const mySub = a.mySubmission;
              const draft = studentSubmit[a.id] || {
                answerText: mySub?.answer_text || '',
                attachmentUrl: mySub?.attachment_url || '',
              };
              const deadlineMs = Date.parse(a.deadline);
              const isPastDeadline = !Number.isNaN(deadlineMs) && Date.now() > deadlineMs;
              const blockedLate = isStudent && isPastDeadline && a.allowLate === false;
              return (
                <div key={a.id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {a.subject} · {a.class_name} · Tenggat:{' '}
                        <span className="font-mono text-slate-800 dark:text-slate-200">{a.deadline.replace('T', ' ')}</span>
                        {' · '}
                        <span className={a.allowLate === false ? 'text-amber-700 dark:text-amber-400 font-medium' : 'text-slate-500 dark:text-slate-400'}>
                          {a.allowLate === false ? 'Tutup Otomatis Setelah Tenggat' : 'Terlambat Diizinkan'}
                        </span>
                      </p>
                      <h4 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 mt-0.5">{a.title}</h4>
                      <p className="text-sm text-slate-700 dark:text-slate-300 mt-1">{a.description}</p>
                    </div>
                    {!isStudent && (isAdmin || a.teacher_id === user.id) && (
                      confirmDeleteId === a.id ? (
                        <button
                          type="button"
                          onClick={() => handleDeleteAssignment(a.id)}
                          className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          Konfirmasi Hapus
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(a.id)}
                          className="rounded-lg border border-slate-200 dark:border-slate-700 p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 cursor-pointer"
                          aria-label="Hapus tugas"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )
                    )}
                  </div>

                  {isStudent ? (
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-4 space-y-3">
                      {mySub && (
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs border-b border-slate-200 dark:border-slate-700 pb-2">
                          <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                            Status: {mySub.status === 'dinilai' ? `Sudah Dinilai (${mySub.score}/100)` : 'Sudah Dikumpulkan'}
                            {' · '}
                            <span className={mySub.is_late ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}>
                              {mySub.is_late ? 'Terlambat' : 'Tepat Waktu'}
                            </span>
                          </span>
                          {mySub.teacher_note && (
                            <span className="text-slate-700 dark:text-slate-300">Catatan Guru: &quot;{mySub.teacher_note}&quot;</span>
                          )}
                        </div>
                      )}
                      {blockedLate && (
                        <p className="text-xs font-medium text-red-700 dark:text-red-400">
                          Batas waktu telah berakhir dan pengumpulan terlambat ditutup oleh guru.
                        </p>
                      )}
                      <textarea
                        rows={3}
                        disabled={blockedLate}
                        placeholder="Tuliskan jawaban tugas Anda (nyaman dikerjakan langsung dari HP)..."
                        value={draft.answerText}
                        onChange={(e) =>
                          setStudentSubmit({ ...studentSubmit, [a.id]: { ...draft, answerText: e.target.value } })
                        }
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 disabled:opacity-60"
                      />
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          disabled={blockedLate}
                          placeholder="Tautan file Drive atau unggah foto/PDF →"
                          value={draft.attachmentUrl}
                          onChange={(e) =>
                            setStudentSubmit({ ...studentSubmit, [a.id]: { ...draft, attachmentUrl: e.target.value } })
                          }
                          className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 disabled:opacity-60"
                        />
                        <label
                          className={`inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 ${
                            blockedLate ? 'opacity-50 pointer-events-none' : 'cursor-pointer'
                          }`}
                        >
                          <Upload className="h-3.5 w-3.5" />
                          <span>{uploadingKey === `sub-${a.id}` ? 'Mengunggah...' : 'Unggah Berkas'}</span>
                          <input
                            type="file"
                            accept=".pdf,.docx,.xlsx,.pptx,.txt,image/*"
                            disabled={blockedLate}
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              void handleFileUpload(file, `sub-${a.id}`, (url) =>
                                setStudentSubmit((prev) => ({
                                  ...prev,
                                  [a.id]: { ...(prev[a.id] || draft), attachmentUrl: url },
                                }))
                              );
                              e.target.value = '';
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          disabled={blockedLate}
                          onClick={() => handleSubmitAssignment(a.id)}
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <Send className="h-3.5 w-3.5" />
                          <span>{mySub ? 'Perbarui Jawaban' : 'Kumpulkan Tugas'}</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Pengumpulan Siswa ({(a.submissions || []).length})
                      </p>
                      {(a.submissions || []).length === 0 ? (
                        <p className="text-xs text-slate-500 dark:text-slate-400">Belum ada siswa mengumpulkan.</p>
                      ) : (
                        (a.submissions || []).map((sub: any) => {
                          const gVal = gradeInputs[sub.id] || {
                            score: sub.score ?? 85,
                            teacherNote: sub.teacher_note || '',
                          };
                          return (
                            <div key={sub.id} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-3 space-y-2 text-xs">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-semibold text-slate-900 dark:text-slate-100">
                                  {sub.student_name} ({sub.class_name}) ·{' '}
                                  <span className={sub.is_late ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}>
                                    {sub.is_late ? 'Terlambat' : 'Tepat Waktu'}
                                  </span>
                                </span>
                                <span className="font-mono text-slate-500 dark:text-slate-400">
                                  {new Date(sub.submitted_at).toLocaleString('id-ID')}
                                </span>
                              </div>
                              <p className="text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950 rounded border border-slate-200 dark:border-slate-700 p-2">{sub.answer_text}</p>
                              {sub.attachment_url && (
                                <a
                                  href={sub.attachment_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-teal-700 dark:text-teal-400 font-semibold hover:underline"
                                >
                                  <span>Lampiran Siswa</span>
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                              <div className="flex flex-wrap items-center gap-2 pt-1">
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  value={gVal.score}
                                  onChange={(e) =>
                                    setGradeInputs({
                                      ...gradeInputs,
                                      [sub.id]: { ...gVal, score: Number(e.target.value) },
                                    })
                                  }
                                  className="w-20 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 font-mono text-slate-900 dark:text-slate-100"
                                />
                                <input
                                  type="text"
                                  placeholder="Catatan umpan balik guru..."
                                  value={gVal.teacherNote}
                                  onChange={(e) =>
                                    setGradeInputs({
                                      ...gradeInputs,
                                      [sub.id]: { ...gVal, teacherNote: e.target.value },
                                    })
                                  }
                                  className="flex-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleGradeSubmission(sub.id)}
                                  className="rounded-lg bg-slate-900 dark:bg-slate-700 px-3 py-1 font-semibold text-white hover:bg-slate-800 dark:hover:bg-slate-600 cursor-pointer"
                                >
                                  Simpan Nilai
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SUBTAB 3: TATAP MUKA ONLINE (GOOGLE MEET) */}
      {subTab === 'meet' && <OnlineMeetingsSection user={user} />}

      {/* SUBTAB 4: JADWAL PELAJARAN & GURU PENGAMPU */}
      {subTab === 'jadwal' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-teal-700 dark:text-teal-400" />
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">Jadwal Pelajaran Per Kelas</h3>
            </div>

            {isAdmin && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  await apiFetch('/api/academic/schedules', {
                    method: 'POST',
                    body: JSON.stringify(schedForm),
                  });
                  loadAll();
                }}
                className="grid grid-cols-2 sm:grid-cols-3 gap-2 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 p-3 text-xs"
              >
                <input
                  type="text"
                  value={schedForm.className}
                  onChange={(e) => setSchedForm({ ...schedForm, className: e.target.value })}
                  placeholder="Kelas"
                  className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                />
                <select
                  value={schedForm.dayName}
                  onChange={(e) => setSchedForm({ ...schedForm, dayName: e.target.value })}
                  className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-slate-900 dark:text-slate-100"
                >
                  {['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'].map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={schedForm.subject}
                  onChange={(e) => setSchedForm({ ...schedForm, subject: e.target.value })}
                  placeholder="Mapel"
                  className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                />
                <input
                  type="time"
                  value={schedForm.startTime}
                  onChange={(e) => setSchedForm({ ...schedForm, startTime: e.target.value })}
                  className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 font-mono text-slate-900 dark:text-slate-100"
                />
                <input
                  type="time"
                  value={schedForm.endTime}
                  onChange={(e) => setSchedForm({ ...schedForm, endTime: e.target.value })}
                  className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 font-mono text-slate-900 dark:text-slate-100"
                />
                <select
                  value={schedForm.teacherId}
                  onChange={(e) => setSchedForm({ ...schedForm, teacherId: e.target.value })}
                  className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-slate-900 dark:text-slate-100"
                >
                  {academic.teachers.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="col-span-2 sm:col-span-3 rounded-lg bg-teal-700 hover:bg-teal-800 py-1.5 font-semibold text-white cursor-pointer"
                >
                  Tambah Slot Jadwal
                </button>
              </form>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-400">
                    <th className="py-2.5 px-3">Kelas</th>
                    <th className="py-2.5 px-3">Hari &amp; Jam</th>
                    <th className="py-2.5 px-3">Mata Pelajaran</th>
                    <th className="py-2.5 px-3">Guru Pengampu</th>
                    <th className="py-2.5 px-3">Ruang</th>
                    {isAdmin && <th className="py-2.5 px-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {academic.schedules.map((sc) => (
                    <tr key={sc.id}>
                      <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-slate-100">{sc.class_name}</td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {sc.day_name}, {sc.start_time}–{sc.end_time}
                      </td>
                      <td className="py-2.5 px-3 text-slate-800 dark:text-slate-200">{sc.subject}</td>
                      <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">{sc.teacher_name}</td>
                      <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400">{sc.room}</td>
                      {isAdmin && (
                        <td className="py-2.5 px-3">
                          <button
                            type="button"
                            onClick={async () => {
                              await apiFetch(`/api/academic/schedules/${sc.id}`, { method: 'DELETE' });
                              loadAll();
                            }}
                            className="text-red-600 dark:text-red-400 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">Pengaturan Guru Pengampu</h3>
            {isAdmin && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  await apiFetch('/api/academic/teacher-assignments', {
                    method: 'POST',
                    body: JSON.stringify(pengampuForm),
                  });
                  loadAll();
                }}
                className="space-y-2 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 p-3 text-xs"
              >
                <select
                  value={pengampuForm.teacherId}
                  onChange={(e) => setPengampuForm({ ...pengampuForm, teacherId: e.target.value })}
                  className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-slate-900 dark:text-slate-100"
                >
                  {academic.teachers.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={pengampuForm.subject}
                    onChange={(e) => setPengampuForm({ ...pengampuForm, subject: e.target.value })}
                    placeholder="Mata Pelajaran"
                    className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                  />
                  <input
                    type="text"
                    value={pengampuForm.className}
                    onChange={(e) => setPengampuForm({ ...pengampuForm, className: e.target.value })}
                    placeholder="Kelas"
                    className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full rounded-lg bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 dark:hover:bg-slate-600 py-1.5 font-semibold text-white cursor-pointer"
                >
                  Tetapkan Guru Pengampu
                </button>
              </form>
            )}
            <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {academic.assignments.map((a) => (
                <div key={a.id} className="py-2.5 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-slate-100">{a.subject}</p>
                    <p className="text-slate-500 dark:text-slate-400">
                      {a.teacher_name} · Kelas {a.class_name}
                    </p>
                  </div>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={async () => {
                        await apiFetch(`/api/academic/teacher-assignments/${a.id}`, { method: 'DELETE' });
                        loadAll();
                      }}
                      className="text-red-600 dark:text-red-400 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
