import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Award,
  Check,
  FileSpreadsheet,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import { apiFetch, downloadAuthorizedFile } from '../lib/api';
import type { User } from '../types';

interface RaporModuleProps {
  user: User;
}

const DEFAULT_CLASSES = ['XII-IPA-1', 'XI-IPA-1', 'X-1'];
const DEFAULT_SUBJECTS = [
  'Matematika Wajib',
  'Fisika',
  'Bahasa Indonesia',
  'Pendidikan Agama Islam & Bahasa Arab',
];

export function RaporModule({ user }: RaporModuleProps) {
  const isStudent = user.role === 'siswa';
  const [subTab, setSubTab] = useState<'tp' | 'nilai' | 'wali' | 'leger' | 'cetak'>(
    isStudent ? 'cetak' : 'nilai'
  );
  const [className, setClassName] = useState('XII-IPA-1');
  const [subject, setSubject] = useState('Matematika Wajib');
  const [semester, setSemester] = useState('Ganjil');
  const [academicYear, setAcademicYear] = useState('2026/2027');
  const [availableClasses, setAvailableClasses] = useState<string[]>(DEFAULT_CLASSES);
  const [availableSubjects, setAvailableSubjects] = useState<string[]>(DEFAULT_SUBJECTS);
  const [notice, setNotice] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // TPs
  const [tps, setTps] = useState<any[]>([]);
  const [tpForm, setTpForm] = useState({ code: '', description: '' });

  // Scores
  const [students, setStudents] = useState<any[]>([]);
  const [scores, setScores] = useState<any[]>([]);
  const [weights, setWeights] = useState({ harian: 50, pts: 25, pas: 25 });
  const [scoreEdits, setScoreEdits] = useState<Record<string, any>>({});

  // Homeroom
  const [homeroomRows, setHomeroomRows] = useState<any[]>([]);

  // Leger
  const [leger, setLeger] = useState<{ subjects: string[]; rows: any[] }>({ subjects: [], rows: [] });

  // Printable A4 Report
  const [selectedStudentId, setSelectedStudentId] = useState(isStudent ? 'me' : '');
  const [reportData, setReportData] = useState<any | null>(null);

  useEffect(() => {
    if (isStudent) return;
    Promise.all([
      apiFetch<any>('/api/academic/overview'),
      apiFetch<any[]>('/api/users?role=siswa'),
    ])
      .then(([ov, allSiswa]) => {
        const clsSet = new Set<string>(DEFAULT_CLASSES);
        const subSet = new Set<string>(DEFAULT_SUBJECTS);
        (allSiswa || []).forEach((s: any) => {
          if (s.status === 'aktif' && s.class_name) clsSet.add(s.class_name);
        });
        (ov?.assignments || []).forEach((a: any) => {
          if (a.class_name) clsSet.add(a.class_name);
          if (a.subject) subSet.add(a.subject);
        });
        (ov?.schedules || []).forEach((sc: any) => {
          if (sc.class_name) clsSet.add(sc.class_name);
          if (sc.subject) subSet.add(sc.subject);
        });
        setAvailableClasses(Array.from(clsSet).sort());
        setAvailableSubjects(Array.from(subSet).sort());
      })
      .catch(() => {
        /* fallback to defaults */
      });
  }, [user.id]);

  async function loadAll() {
    setErrorMsg('');
    if (isStudent) {
      const rep = await apiFetch<any>(
        `/api/rapor/student-report/me?semester=${semester}&academicYear=${encodeURIComponent(academicYear)}`
      );
      setReportData(rep);
      return;
    }

    const ayParam = `academicYear=${encodeURIComponent(academicYear)}`;
    const [tpRows, scoreRows, sts, hrRows, legerData] = await Promise.all([
      apiFetch<any[]>(
        `/api/rapor/tps?subject=${encodeURIComponent(subject)}&className=${encodeURIComponent(className)}&semester=${encodeURIComponent(semester)}`
      ),
      apiFetch<any[]>(
        `/api/rapor/scores?className=${encodeURIComponent(className)}&subject=${encodeURIComponent(subject)}&semester=${semester}&${ayParam}`
      ),
      apiFetch<any[]>(`/api/users?role=siswa&className=${encodeURIComponent(className)}`),
      apiFetch<any[]>(
        `/api/rapor/homeroom?className=${encodeURIComponent(className)}&semester=${semester}&${ayParam}`
      ),
      apiFetch<any>(
        `/api/rapor/leger?className=${encodeURIComponent(className)}&semester=${semester}&${ayParam}`
      ),
    ]);

    const activeSts = sts.filter((s) => s.status === 'aktif');
    setTps(tpRows);
    setScores(scoreRows);
    setStudents(activeSts);
    setHomeroomRows(hrRows);
    setLeger(legerData);

    const map: Record<string, any> = {};
    for (const st of activeSts) {
      const found = scoreRows.find((r) => r.student_id === st.id);
      map[st.id] = {
        harianScore: found?.harian_score ?? 82,
        ptsScore: found?.pts_score ?? 80,
        pasScore: found?.pas_score ?? 84,
        tpAchievedIds: found ? JSON.parse(found.tp_achieved_ids_json || '[]') : tpRows.map((t) => t.id),
        tpNeedsGuidanceIds: found ? JSON.parse(found.tp_needs_guidance_ids_json || '[]') : [],
      };
    }
    setScoreEdits(map);

    if (activeSts.length > 0 && (!selectedStudentId || selectedStudentId === 'me' || !activeSts.some((s) => s.id === selectedStudentId))) {
      setSelectedStudentId(activeSts[0].id);
    }
  }

  useEffect(() => {
    loadAll();
  }, [className, subject, semester, academicYear, user.id]);

  useEffect(() => {
    if (!selectedStudentId || isStudent) return;
    apiFetch<any>(
      `/api/rapor/student-report/${selectedStudentId}?semester=${semester}&academicYear=${encodeURIComponent(academicYear)}`
    )
      .then(setReportData)
      .catch(() => setReportData(null));
  }, [selectedStudentId, semester, academicYear, subTab]);

  function toggleStudentTp(studentId: string, tpId: string, target: 'achieved' | 'guidance' | 'none') {
    const ed = scoreEdits[studentId];
    if (!ed) return;
    let nextAch = (ed.tpAchievedIds || []).filter((id: string) => id !== tpId);
    let nextGui = (ed.tpNeedsGuidanceIds || []).filter((id: string) => id !== tpId);
    if (target === 'achieved') nextAch = [...nextAch, tpId];
    if (target === 'guidance') nextGui = [...nextGui, tpId];
    setScoreEdits({
      ...scoreEdits,
      [studentId]: { ...ed, tpAchievedIds: nextAch, tpNeedsGuidanceIds: nextGui },
    });
  }

  async function handleSaveStudentScore(studentId: string) {
    setErrorMsg('');
    const ed = scoreEdits[studentId];
    await apiFetch('/api/rapor/scores', {
      method: 'POST',
      body: JSON.stringify({
        studentId,
        subject,
        className,
        semester,
        academicYear,
        harianScore: ed.harianScore,
        ptsScore: ed.ptsScore,
        pasScore: ed.pasScore,
        weightHarian: weights.harian,
        weightPts: weights.pts,
        weightPas: weights.pas,
        tpAchievedIds: ed.tpAchievedIds,
        tpNeedsGuidanceIds: ed.tpNeedsGuidanceIds,
      }),
    });
    setNotice('Nilai rapor & deskripsi capaian kompetensi otomatis disimpan.');
    loadAll();
  }

  async function handleSyncFromCbt() {
    setErrorMsg('');
    const res = await apiFetch<{ updatedCount: number }>('/api/rapor/sync-cbt-tasks', {
      method: 'POST',
      body: JSON.stringify({ className, subject, semester, academicYear }),
    });
    setNotice(`${res.updatedCount} nilai siswa berhasil disinkronkan dari hasil CBT dan Tugas E-Learning.`);
    loadAll();
  }

  const totalWeights = weights.harian + weights.pts + weights.pas;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 no-print">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">Rapor Kurikulum Merdeka</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Tujuan Pembelajaran, bobot Harian/PTS/PAS, sinkron CBT &amp; Tugas, deskripsi otomatis, leger peringkat, dan cetak A4.
          </p>
        </div>

        {!isStudent && (
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg overflow-x-auto">
            {[
              { id: 'tp', label: 'Tujuan Pembelajaran' },
              { id: 'nilai', label: 'Nilai & Deskripsi' },
              { id: 'wali', label: 'Wali Kelas' },
              { id: 'leger', label: 'Leger & Peringkat' },
              { id: 'cetak', label: 'Cetak Rapor A4' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSubTab(t.id as any)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
                  subTab === t.id
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-xs no-print">
        {!isStudent && (
          <>
            <select
              value={className}
              onChange={(e) => setClassName(e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-1.5 font-medium"
            >
              {availableClasses.map((cls) => (
                <option key={cls} value={cls}>
                  Kelas {cls}
                </option>
              ))}
            </select>
            <select
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-1.5 font-medium"
            >
              {availableSubjects.map((sub) => (
                <option key={sub} value={sub}>
                  {sub}
                </option>
              ))}
            </select>
          </>
        )}
        <select
          value={semester}
          onChange={(e) => setSemester(e.target.value)}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-1.5 font-medium"
        >
          <option value="Ganjil">Semester Ganjil</option>
          <option value="Genap">Semester Genap</option>
        </select>
        <select
          value={academicYear}
          onChange={(e) => setAcademicYear(e.target.value)}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-1.5 font-mono font-medium"
        >
          <option value="2025/2026">TA 2025/2026</option>
          <option value="2026/2027">TA 2026/2027</option>
          <option value="2027/2028">TA 2027/2028</option>
        </select>
      </div>

      {notice && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 px-4 py-2.5 text-xs text-emerald-800 dark:text-emerald-300 no-print">
          {notice}
        </div>
      )}
      {errorMsg && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 px-4 py-2.5 text-xs text-red-800 dark:text-red-300 no-print">
          {errorMsg}
        </div>
      )}

      {/* TP TAB */}
      {subTab === 'tp' && !isStudent && (
        <div className="space-y-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await apiFetch('/api/rapor/tps', {
                method: 'POST',
                body: JSON.stringify({ subject, className, semester, ...tpForm }),
              });
              setTpForm({ code: '', description: '' });
              setNotice('Tujuan Pembelajaran ditambahkan.');
              loadAll();
            }}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 grid grid-cols-1 md:grid-cols-6 gap-3 items-end"
          >
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Kode TP</label>
              <input
                type="text"
                required
                placeholder="TP-M4"
                value={tpForm.code}
                onChange={(e) => setTpForm({ ...tpForm, code: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 text-xs font-mono"
              />
            </div>
            <div className="md:col-span-4">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Deskripsi Capaian Tujuan Pembelajaran</label>
              <input
                type="text"
                required
                placeholder="Contoh: menganalisis penerapan integral tentu pada luas daerah"
                value={tpForm.description}
                onChange={(e) => setTpForm({ ...tpForm, description: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Tambah TP</span>
            </button>
          </form>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
            {tps.map((tp) => (
              <div key={tp.id} className="p-4 flex items-center justify-between gap-4 text-sm">
                <div>
                  <span className="font-mono text-xs font-bold text-teal-800 dark:text-teal-300 mr-2">{tp.code}</span>
                  <span className="text-slate-800 dark:text-slate-200">{tp.description}</span>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch(`/api/rapor/tps/${tp.id}`, { method: 'DELETE' });
                    loadAll();
                  }}
                  className="text-red-600 dark:text-red-400 cursor-pointer"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            {tps.length === 0 && (
              <p className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                Belum ada Tujuan Pembelajaran untuk {subject} kelas {className} semester {semester}.
              </p>
            )}
          </div>
        </div>
      )}

      {/* NILAI & DESKRIPSI OTOMATIS */}
      {subTab === 'nilai' && !isStudent && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
            <div className="flex flex-wrap items-center gap-3 text-slate-700 dark:text-slate-300">
              <span className="font-semibold text-slate-700 dark:text-slate-200">Bobot Nilai Akhir (%):</span>
              <label className="inline-flex items-center gap-1">
                <span>Harian</span>
                <input
                  type="number"
                  value={weights.harian}
                  onChange={(e) => setWeights({ ...weights, harian: Number(e.target.value) })}
                  className="w-14 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2 py-1 font-mono tabular-nums"
                />
              </label>
              <label className="inline-flex items-center gap-1">
                <span>PTS</span>
                <input
                  type="number"
                  value={weights.pts}
                  onChange={(e) => setWeights({ ...weights, pts: Number(e.target.value) })}
                  className="w-14 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2 py-1 font-mono tabular-nums"
                />
              </label>
              <label className="inline-flex items-center gap-1">
                <span>PAS</span>
                <input
                  type="number"
                  value={weights.pas}
                  onChange={(e) => setWeights({ ...weights, pas: Number(e.target.value) })}
                  className="w-14 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2 py-1 font-mono tabular-nums"
                />
              </label>
              {totalWeights !== 100 && (
                <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-semibold">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Total bobot: {totalWeights}% (idealnya 100%)
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={handleSyncFromCbt}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-slate-700 px-3.5 py-2 font-semibold text-white hover:bg-slate-800 dark:hover:bg-slate-600 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Ambil Nilai dari CBT &amp; Tugas</span>
            </button>
          </div>

          <div className="space-y-4">
            {students.map((st) => {
              const ed = scoreEdits[st.id] || {
                harianScore: 80,
                ptsScore: 80,
                pasScore: 80,
                tpAchievedIds: [],
                tpNeedsGuidanceIds: [],
              };
              const savedRow = scores.find((r) => r.student_id === st.id);
              const wSum = Math.max(1, weights.harian + weights.pts + weights.pas);
              const previewFinal = (
                (ed.harianScore * weights.harian + ed.ptsScore * weights.pts + ed.pasScore * weights.pas) /
                wSum
              ).toFixed(2);

              return (
                <div key={st.id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">{st.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">NIS {st.username}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                      <label className="flex items-center gap-1">
                        <span>Harian</span>
                        <input
                          type="number"
                          value={ed.harianScore}
                          onChange={(e) =>
                            setScoreEdits({
                              ...scoreEdits,
                              [st.id]: { ...ed, harianScore: Number(e.target.value) },
                            })
                          }
                          className="w-16 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2 py-1 font-mono tabular-nums"
                        />
                      </label>
                      <label className="flex items-center gap-1">
                        <span>PTS</span>
                        <input
                          type="number"
                          value={ed.ptsScore}
                          onChange={(e) =>
                            setScoreEdits({
                              ...scoreEdits,
                              [st.id]: { ...ed, ptsScore: Number(e.target.value) },
                            })
                          }
                          className="w-16 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2 py-1 font-mono tabular-nums"
                        />
                      </label>
                      <label className="flex items-center gap-1">
                        <span>PAS</span>
                        <input
                          type="number"
                          value={ed.pasScore}
                          onChange={(e) =>
                            setScoreEdits({
                              ...scoreEdits,
                              [st.id]: { ...ed, pasScore: Number(e.target.value) },
                            })
                          }
                          className="w-16 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2 py-1 font-mono tabular-nums"
                        />
                      </label>
                      <span className="font-mono tabular-nums font-bold text-teal-800 dark:text-teal-300 px-2">Akhir: {previewFinal}</span>
                      <button
                        type="button"
                        onClick={() => handleSaveStudentScore(st.id)}
                        className="inline-flex items-center gap-1 rounded-lg bg-teal-700 px-3 py-1.5 font-semibold text-white hover:bg-teal-800 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Save className="h-3.5 w-3.5" />
                        <span>Simpan</span>
                      </button>
                    </div>
                  </div>

                  {tps.length > 0 && (
                    <div className="border-t border-slate-100 dark:border-slate-800 pt-3 space-y-2">
                      <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                        Penilaian Capaian Tujuan Pembelajaran (pembentuk deskripsi otomatis):
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {tps.map((tp) => {
                          const isAchieved = (ed.tpAchievedIds || []).includes(tp.id);
                          const isGuidance = (ed.tpNeedsGuidanceIds || []).includes(tp.id);
                          return (
                            <div
                              key={tp.id}
                              className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs flex items-center justify-between gap-2"
                            >
                              <div className="min-w-0">
                                <span className="font-mono font-bold text-teal-800 dark:text-teal-300 mr-1.5">{tp.code}</span>
                                <span className="text-slate-700 dark:text-slate-300">{tp.description}</span>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => toggleStudentTp(st.id, tp.id, isAchieved ? 'none' : 'achieved')}
                                  className={`px-2 py-1 rounded text-[11px] font-semibold whitespace-nowrap cursor-pointer ${
                                    isAchieved
                                      ? 'bg-emerald-700 text-white'
                                      : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                                  }`}
                                >
                                  {isAchieved && <Check className="inline h-3 w-3 mr-0.5" />}
                                  Tercapai
                                </button>
                                <button
                                  type="button"
                                  onClick={() => toggleStudentTp(st.id, tp.id, isGuidance ? 'none' : 'guidance')}
                                  className={`px-2 py-1 rounded text-[11px] font-semibold whitespace-nowrap cursor-pointer ${
                                    isGuidance
                                      ? 'bg-amber-600 text-white'
                                      : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                                  }`}
                                >
                                  Perlu Bimbingan
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {savedRow?.competency_description && (
                    <p className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/70 rounded-lg p-3">
                      <strong className="text-slate-900 dark:text-slate-100">Deskripsi Otomatis:</strong> {savedRow.competency_description}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* WALI KELAS (EKSKUL, KETIDAKHADIRAN DARI ABSENSI, CATATAN, KENAIKAN) */}
      {subTab === 'wali' && !isStudent && (
        <div className="space-y-4">
          {homeroomRows.map((row, idx) => (
            <div key={row.studentId} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">{row.studentName}</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">NIS {row.nis} · Kelas {row.className}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = [...homeroomRows];
                    next[idx] = {
                      ...row,
                      sakit: row.attendanceSuggestion.sakit,
                      izin: row.attendanceSuggestion.izin,
                      alpha: row.attendanceSuggestion.alpha,
                    };
                    setHomeroomRows(next);
                  }}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-teal-800 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/60 cursor-pointer"
                >
                  Isi Ketidakhadiran dari Data Absensi ({row.attendanceSuggestion.sakit}S/{row.attendanceSuggestion.izin}I/{row.attendanceSuggestion.alpha}A)
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs text-slate-700 dark:text-slate-300">
                <div className="flex items-center gap-2">
                  <label>S: <input type="number" value={row.sakit} onChange={(e) => {
                    const next = [...homeroomRows]; next[idx] = { ...row, sakit: Number(e.target.value) }; setHomeroomRows(next);
                  }} className="w-12 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2 py-1 font-mono tabular-nums" /></label>
                  <label>I: <input type="number" value={row.izin} onChange={(e) => {
                    const next = [...homeroomRows]; next[idx] = { ...row, izin: Number(e.target.value) }; setHomeroomRows(next);
                  }} className="w-12 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2 py-1 font-mono tabular-nums" /></label>
                  <label>A: <input type="number" value={row.alpha} onChange={(e) => {
                    const next = [...homeroomRows]; next[idx] = { ...row, alpha: Number(e.target.value) }; setHomeroomRows(next);
                  }} className="w-12 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2 py-1 font-mono tabular-nums" /></label>
                </div>
                <input
                  type="text"
                  placeholder="Catatan Wali Kelas"
                  value={row.homeroomNote}
                  onChange={(e) => {
                    const next = [...homeroomRows]; next[idx] = { ...row, homeroomNote: e.target.value }; setHomeroomRows(next);
                  }}
                  className="md:col-span-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-1.5"
                />
                <select
                  value={row.promotionStatus}
                  onChange={(e) => {
                    const next = [...homeroomRows]; next[idx] = { ...row, promotionStatus: e.target.value }; setHomeroomRows(next);
                  }}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-1.5"
                >
                  <option value="Proses">Dalam Proses</option>
                  <option value="Naik ke Kelas XI">Naik ke Kelas XI</option>
                  <option value="Naik ke Kelas XII">Naik ke Kelas XII</option>
                  <option value="Lulus">Lulus Satuan Pendidikan</option>
                  <option value="Tinggal Kelas">Tinggal Kelas</option>
                </select>
              </div>

              {/* Ekstrakurikuler Editor */}
              <div className="border-t border-slate-100 dark:border-slate-800 pt-3 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">Ekstrakurikuler</span>
                  <button
                    type="button"
                    onClick={() => {
                      const next = [...homeroomRows];
                      const currentEx = row.extracurriculars || [];
                      next[idx] = {
                        ...row,
                        extracurriculars: [...currentEx, { name: '', predicate: 'Baik', note: '' }],
                      };
                      setHomeroomRows(next);
                    }}
                    className="inline-flex items-center gap-1 rounded border border-slate-200 dark:border-slate-700 px-2.5 py-1 font-semibold text-teal-800 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/60 cursor-pointer"
                  >
                    <Plus className="h-3 w-3" />
                    <span>Tambah Ekskul</span>
                  </button>
                </div>
                {(row.extracurriculars || []).map((ex: any, exIdx: number) => (
                  <div key={exIdx} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                    <input
                      type="text"
                      placeholder="Nama kegiatan (mis. Pramuka, KIR)"
                      value={ex.name || ''}
                      onChange={(e) => {
                        const next = [...homeroomRows];
                        const list = [...(row.extracurriculars || [])];
                        list[exIdx] = { ...ex, name: e.target.value };
                        next[idx] = { ...row, extracurriculars: list };
                        setHomeroomRows(next);
                      }}
                      className="sm:col-span-4 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-2.5 py-1.5"
                    />
                    <select
                      value={ex.predicate || 'Baik'}
                      onChange={(e) => {
                        const next = [...homeroomRows];
                        const list = [...(row.extracurriculars || [])];
                        list[exIdx] = { ...ex, predicate: e.target.value };
                        next[idx] = { ...row, extracurriculars: list };
                        setHomeroomRows(next);
                      }}
                      className="sm:col-span-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2 py-1.5"
                    >
                      <option value="Sangat Baik">Sangat Baik</option>
                      <option value="Baik">Baik</option>
                      <option value="Cukup">Cukup</option>
                    </select>
                    <input
                      type="text"
                      placeholder="Keterangan capaian..."
                      value={ex.note || ''}
                      onChange={(e) => {
                        const next = [...homeroomRows];
                        const list = [...(row.extracurriculars || [])];
                        list[exIdx] = { ...ex, note: e.target.value };
                        next[idx] = { ...row, extracurriculars: list };
                        setHomeroomRows(next);
                      }}
                      className="sm:col-span-5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-2.5 py-1.5"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const next = [...homeroomRows];
                        const list = [...(row.extracurriculars || [])].filter((_, i) => i !== exIdx);
                        next[idx] = { ...row, extracurriculars: list };
                        setHomeroomRows(next);
                      }}
                      className="sm:col-span-1 text-red-600 dark:text-red-400 flex justify-center cursor-pointer"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch('/api/rapor/homeroom', {
                      method: 'POST',
                      body: JSON.stringify({ ...row, semester, academicYear }),
                    });
                    setNotice(`Data wali kelas untuk ${row.studentName} disimpan.`);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>Simpan Data Wali Kelas</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* LEGER & PERINGKAT */}
      {subTab === 'leger' && !isStudent && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4 overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Award className="h-4 w-4 text-teal-700 dark:text-teal-400" />
              <span>Leger Nilai &amp; Peringkat Kelas {className} ({semester} · {academicYear})</span>
            </h3>
            <button
              type="button"
              onClick={() =>
                downloadAuthorizedFile(
                  `/api/rapor/leger/export?className=${encodeURIComponent(className)}&semester=${encodeURIComponent(semester)}&academicYear=${encodeURIComponent(academicYear)}`,
                  `leger-${className}-${semester}.xlsx`
                )
              }
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileSpreadsheet className="h-4 w-4" />
              <span>Ekspor Leger (.xlsx)</span>
            </button>
          </div>
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-400">
                <th className="py-2.5 px-3">Peringkat</th>
                <th className="py-2.5 px-3">NIS</th>
                <th className="py-2.5 px-3">Nama Siswa</th>
                {leger.subjects.map((sub) => (
                  <th key={sub} className="py-2.5 px-3 text-right">{sub}</th>
                ))}
                <th className="py-2.5 px-3 text-right">Jumlah</th>
                <th className="py-2.5 px-3 text-right">Rata-rata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {leger.rows.map((r) => (
                <tr key={r.studentId}>
                  <td className="py-2.5 px-3 font-mono font-bold text-teal-800 dark:text-teal-300">#{r.rank}</td>
                  <td className="py-2.5 px-3 font-mono tabular-nums text-slate-700 dark:text-slate-300">{r.nis}</td>
                  <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-slate-100">{r.name}</td>
                  {leger.subjects.map((sub) => (
                    <td key={sub} className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {r.subjectMap[sub]}
                    </td>
                  ))}
                  <td className="py-2.5 px-3 text-right font-mono font-semibold tabular-nums text-slate-800 dark:text-slate-200">{r.total}</td>
                  <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">{r.average}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* CETAK RAPOR A4/PDF (Guru/Wali/Admin & Siswa View) */}
      {subTab === 'cetak' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 no-print">
            {!isStudent ? (
              <select
                value={selectedStudentId}
                onChange={(e) => setSelectedStudentId(e.target.value)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm font-medium"
              >
                {students.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name} ({st.class_name})
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Laporan Hasil Belajar Anda (Kurikulum Merdeka)</p>
            )}
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 dark:bg-slate-700 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-slate-600 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Printer className="h-4 w-4" />
              <span>Cetak Rapor A4 / Simpan PDF</span>
            </button>
          </div>

          {reportData && (
            <div className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 p-8 max-w-[210mm] mx-auto space-y-6 print-page">
              <div className="border-b-2 border-slate-900 dark:border-slate-400 pb-4 text-center">
                <p className="font-display text-lg font-bold uppercase tracking-wide text-slate-900 dark:text-slate-100">
                  {reportData.schoolName}
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400">Laporan Hasil Belajar Peserta Didik (Kurikulum Merdeka)</p>
              </div>

              <div className="grid grid-cols-2 gap-4 text-xs">
                <div className="space-y-1">
                  <p>Nama Siswa: <strong>{reportData.student.name}</strong></p>
                  <p>NIS / NISN: <span className="font-mono">{reportData.student.nis} / {reportData.student.nisn}</span></p>
                </div>
                <div className="space-y-1">
                  <p>Kelas / Fase: <strong>{reportData.student.class_name}</strong></p>
                  <p>Semester / Tahun Ajaran: {reportData.semester} / {reportData.academicYear}</p>
                </div>
              </div>

              <table className="w-full text-left text-xs border border-slate-300 dark:border-slate-700 border-collapse">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-300 dark:border-slate-700 font-semibold">
                    <th className="p-2.5 border-r border-slate-300 dark:border-slate-700 w-10">No</th>
                    <th className="p-2.5 border-r border-slate-300 dark:border-slate-700 w-44">Mata Pelajaran</th>
                    <th className="p-2.5 border-r border-slate-300 dark:border-slate-700 text-right w-24">Nilai Akhir</th>
                    <th className="p-2.5">Capaian Kompetensi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-300 dark:divide-slate-700">
                  {reportData.subjects.map((s: any, idx: number) => (
                    <tr key={s.id} className="align-top">
                      <td className="p-2.5 border-r border-slate-300 dark:border-slate-700 font-mono">{idx + 1}</td>
                      <td className="p-2.5 border-r border-slate-300 dark:border-slate-700 font-semibold">{s.subject}</td>
                      <td className="p-2.5 border-r border-slate-300 dark:border-slate-700 text-right font-mono font-bold tabular-nums">
                        {s.final_score}
                      </td>
                      <td className="p-2.5 leading-relaxed">{s.competency_description}</td>
                    </tr>
                  ))}
                  {reportData.subjects.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-4 text-center text-slate-500 dark:text-slate-400">
                        Belum ada nilai mata pelajaran pada semester dan tahun ajaran ini.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div className="border border-slate-300 dark:border-slate-700 p-3 space-y-1.5">
                  <p className="font-bold border-b border-slate-200 dark:border-slate-700 pb-1">Ekstrakurikuler</p>
                  {(reportData.homeroom.extracurriculars || []).length === 0 ? (
                    <p className="text-slate-500 dark:text-slate-400">-</p>
                  ) : (
                    reportData.homeroom.extracurriculars.map((ex: any, i: number) => (
                      <p key={i}>
                        <strong>{ex.name}</strong> ({ex.predicate}){ex.note ? `: ${ex.note}` : ''}
                      </p>
                    ))
                  )}
                </div>
                <div className="border border-slate-300 dark:border-slate-700 p-3 space-y-1">
                  <p className="font-bold border-b border-slate-200 dark:border-slate-700 pb-1">Ketidakhadiran</p>
                  <p>Sakit: <span className="font-mono tabular-nums">{reportData.homeroom.sakit}</span> hari</p>
                  <p>Izin: <span className="font-mono tabular-nums">{reportData.homeroom.izin}</span> hari</p>
                  <p>Tanpa Keterangan (Alpha): <span className="font-mono tabular-nums">{reportData.homeroom.alpha}</span> hari</p>
                </div>
              </div>

              <div className="border border-slate-300 dark:border-slate-700 p-3 text-xs space-y-1">
                <p className="font-bold">Catatan Wali Kelas &amp; Keterangan Kenaikan</p>
                <p>{reportData.homeroom.homeroom_note || '-'}</p>
                <p className="pt-1 font-semibold">Status: {reportData.homeroom.promotion_status}</p>
              </div>

              {/* Official A4 Signature Block */}
              <div className="grid grid-cols-3 gap-6 pt-6 text-xs text-slate-800 dark:text-slate-200">
                <div className="text-center space-y-14">
                  <p>Mengetahui,<br />Orang Tua / Wali</p>
                  <p className="border-t border-slate-400 dark:border-slate-600 pt-1 mx-4 font-semibold">( .............................. )</p>
                </div>
                <div className="text-center space-y-14">
                  <p>Mengetahui,<br />Kepala Sekolah</p>
                  <p className="border-t border-slate-400 dark:border-slate-600 pt-1 mx-4 font-semibold">Drs. Hendra Wijaya, M.M.</p>
                </div>
                <div className="text-center space-y-14">
                  <p>Wali Kelas {reportData.student.class_name}<br />&nbsp;</p>
                  <p className="border-t border-slate-400 dark:border-slate-600 pt-1 mx-4 font-semibold">Wali Kelas Terkait</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
