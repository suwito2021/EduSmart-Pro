import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  FileSpreadsheet,
  GraduationCap,
  Printer,
  Save,
  Search,
  Upload,
  UserCheck,
} from 'lucide-react';
import { apiFetch, downloadAuthorizedFile, uploadFileToServer } from '../lib/api';
import type { User } from '../types';

interface BukuIndukModuleProps {
  user: User;
}

export function BukuIndukModule({ user }: BukuIndukModuleProps) {
  const isAdmin = user.role === 'admin';
  const canEdit = user.role === 'admin' || user.role === 'wali_kelas';
  const [subTab, setSubTab] = useState<'induk' | 'massal' | 'alumni'>('induk');
  const [records, setRecords] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [editRecord, setEditRecord] = useState<any | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'aktif' | 'lulus'>('all');
  const [photoUploading, setPhotoUploading] = useState(false);

  // Batch process state
  const [selectedForBatch, setSelectedForBatch] = useState<string[]>([]);
  const [batchClassFilter, setBatchClassFilter] = useState('');
  const [batchAction, setBatchAction] = useState<'promote' | 'graduate'>('graduate');
  const [targetClass, setTargetClass] = useState('XII-IPA-1');
  const [batchYear, setBatchYear] = useState('2026/2027');
  const [gradYear, setGradYear] = useState('2026');
  const [confirmBatchOpen, setConfirmBatchOpen] = useState(false);

  // Alumni inline tracer edit
  const [alumniSearch, setAlumniSearch] = useState('');
  const [editingAlumniId, setEditingAlumniId] = useState('');
  const [alumniForm, setAlumniForm] = useState({
    graduationYear: '',
    diplomaNumber: '',
    alumniDestination: '',
    alumniNotes: '',
  });

  const [notice, setNotice] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  async function loadRecords() {
    const data = await apiFetch<any[]>('/api/buku-induk');
    setRecords(data);
    if (data.length > 0) {
      const target = data.find((r) => r.id === selectedId) || data[0];
      setSelectedId(target.id);
      setEditRecord(target);
    }
  }

  useEffect(() => {
    loadRecords();
  }, [user.id]);

  const activeStudents = records.filter((r) => r.status === 'aktif');
  const alumniList = records.filter((r) => r.status === 'lulus');

  const filteredRecords = records.filter((r) => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      String(r.name || '').toLowerCase().includes(q) ||
      String(r.nis || '').toLowerCase().includes(q) ||
      String(r.nisn || '').toLowerCase().includes(q) ||
      String(r.class_name || '').toLowerCase().includes(q)
    );
  });

  const batchFilteredActive = activeStudents.filter((s) =>
    batchClassFilter ? s.class_name === batchClassFilter : true
  );
  const activeClassList = Array.from(new Set(activeStudents.map((s) => s.class_name).filter(Boolean))).sort();

  const filteredAlumni = alumniList.filter((al) => {
    if (!alumniSearch.trim()) return true;
    const q = alumniSearch.toLowerCase();
    return (
      String(al.name || '').toLowerCase().includes(q) ||
      String(al.nis || '').toLowerCase().includes(q) ||
      String(al.graduation_year || '').toLowerCase().includes(q) ||
      String(al.alumni_destination || '').toLowerCase().includes(q)
    );
  });

  async function handlePhotoUpload(file: File) {
    if (!editRecord) return;
    setErrorMsg('');
    setPhotoUploading(true);
    try {
      const uploaded = await uploadFileToServer(file);
      setEditRecord({ ...editRecord, photo_url: uploaded.url });
      setNotice('Pas foto diunggah. Tekan "Simpan" untuk memperbarui buku induk permanen.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal mengunggah pas foto.');
    } finally {
      setPhotoUploading(false);
    }
  }

  async function saveRecord() {
    if (!editRecord) return;
    setErrorMsg('');
    await apiFetch(`/api/buku-induk/${editRecord.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: editRecord.name,
        className: editRecord.class_name,
        photoUrl: editRecord.photo_url,
        birthPlace: editRecord.birth_place,
        birthDate: editRecord.birth_date,
        gender: editRecord.gender,
        religion: editRecord.religion,
        address: editRecord.address,
        fatherName: editRecord.father_name,
        fatherJob: editRecord.father_job,
        motherName: editRecord.mother_name,
        motherJob: editRecord.mother_job,
        parentPhone: editRecord.parent_phone,
        previousSchool: editRecord.previous_school,
        graduationYear: editRecord.graduation_year,
        diplomaNumber: editRecord.diploma_number,
        alumniDestination: editRecord.alumni_destination,
        alumniNotes: editRecord.alumni_notes,
      }),
    });
    setNotice(`Data buku induk / alumni untuk ${editRecord.name} disimpan.`);
    await loadRecords();
  }

  async function saveAlumniTracer(al: any) {
    setErrorMsg('');
    await apiFetch(`/api/buku-induk/${al.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: al.name,
        className: al.class_name,
        photoUrl: al.photo_url,
        birthPlace: al.birth_place,
        birthDate: al.birth_date,
        gender: al.gender,
        religion: al.religion,
        address: al.address,
        fatherName: al.father_name,
        fatherJob: al.father_job,
        motherName: al.mother_name,
        motherJob: al.mother_job,
        parentPhone: al.parent_phone,
        previousSchool: al.previous_school,
        graduationYear: alumniForm.graduationYear,
        diplomaNumber: alumniForm.diplomaNumber,
        alumniDestination: alumniForm.alumniDestination,
        alumniNotes: alumniForm.alumniNotes,
      }),
    });
    setEditingAlumniId('');
    setNotice(`Data tracer studi alumni ${al.name} diperbarui.`);
    await loadRecords();
  }

  async function runBatchProcess() {
    if (selectedForBatch.length === 0) return;
    setErrorMsg('');
    const res = await apiFetch<{ processedCount: number }>('/api/buku-induk/batch-process', {
      method: 'POST',
      body: JSON.stringify({
        studentIds: selectedForBatch,
        action: batchAction,
        targetClassName: targetClass,
        academicYear: batchYear,
        graduationYear: gradYear,
      }),
    });
    setSelectedForBatch([]);
    setConfirmBatchOpen(false);
    setNotice(
      batchAction === 'graduate'
        ? `${res.processedCount} siswa diluluskan ke Alumni dan akses login mereka otomatis dinonaktifkan.`
        : `${res.processedCount} siswa dinaikkan ke kelas ${targetClass}.`
    );
    loadRecords();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 no-print">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">Buku Induk Siswa &amp; Alumni</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Biodata lengkap dengan pas foto, riwayat kelas per semester, cetak lembar buku induk A4, kenaikan &amp; kelulusan massal.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg overflow-x-auto">
          <button
            type="button"
            onClick={() => setSubTab('induk')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
              subTab === 'induk'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            Lembar Buku Induk
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setSubTab('massal')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
                subTab === 'massal'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Kenaikan &amp; Kelulusan Massal
            </button>
          )}
          <button
            type="button"
            onClick={() => setSubTab('alumni')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
              subTab === 'alumni'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            Direktori Alumni ({alumniList.length})
          </button>
        </div>
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

      {/* SUBTAB 1: LEMBAR BUKU INDUK + PRINT A4 */}
      {subTab === 'induk' && editRecord && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3 max-h-[680px] overflow-y-auto no-print">
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">Pilih Peserta Didik</p>
            {user.role !== 'siswa' && (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    placeholder="Cari nama, NIS, atau kelas..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 pl-8 pr-3 py-1.5 text-xs"
                  />
                </div>
                <div className="flex gap-1 text-[11px]">
                  {[
                    { id: 'all', label: 'Semua' },
                    { id: 'aktif', label: 'Aktif' },
                    { id: 'lulus', label: 'Alumni' },
                  ].map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => setStatusFilter(st.id as any)}
                      className={`px-2.5 py-1 rounded font-semibold cursor-pointer ${
                        statusFilter === st.id
                          ? 'bg-slate-900 dark:bg-teal-700 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-2">
              {filteredRecords.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(r.id);
                    setEditRecord(r);
                  }}
                  className={`w-full text-left rounded-lg border p-3 flex items-center gap-3 cursor-pointer ${
                    selectedId === r.id
                      ? 'border-teal-700 dark:border-teal-500 bg-teal-50/70 dark:bg-teal-950/50'
                      : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/70'
                  }`}
                >
                  <img
                    src={r.photo_url}
                    alt={r.name}
                    referrerPolicy="no-referrer"
                    className="h-10 w-10 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">{r.name}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      NIS {r.nis} · {r.status === 'lulus' ? `Alumni ${r.graduation_year}` : r.class_name}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="lg:col-span-8 rounded-xl border border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 space-y-6 print-page">
            <div className="flex items-start justify-between gap-4 border-b-2 border-slate-900 dark:border-slate-500 pb-4">
              <div>
                <h3 className="font-display text-lg font-bold uppercase text-slate-900 dark:text-slate-100">
                  Lembar Buku Induk Peserta Didik
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400">SMA Negeri Terpadu Lentera Eduka</p>
              </div>
              <div className="flex items-center gap-2 no-print">
                {canEdit && (
                  <button
                    type="button"
                    onClick={saveRecord}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Save className="h-3.5 w-3.5" />
                    <span>Simpan</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-slate-600 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>Cetak Buku Induk</span>
                </button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-6 items-start">
              <div className="space-y-2 shrink-0">
                <div className="w-28 h-36 rounded-lg overflow-hidden border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
                  <img
                    src={editRecord.photo_url}
                    alt={`Pas foto ${editRecord.name}`}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                </div>
                {canEdit && (
                  <label className="no-print w-28 inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
                    <Upload className="h-3 w-3" />
                    <span>{photoUploading ? 'Mengunggah...' : 'Ganti Foto'}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handlePhotoUpload(file);
                      }}
                    />
                  </label>
                )}
              </div>

              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs w-full">
                <div>
                  <label className="text-slate-500 dark:text-slate-400">Nama Lengkap</label>
                  <input
                    type="text"
                    readOnly={!canEdit}
                    value={editRecord.name}
                    onChange={(e) => setEditRecord({ ...editRecord, name: e.target.value })}
                    className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 font-semibold text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="text-slate-500 dark:text-slate-400">NIS / NISN</label>
                  <p className="py-1.5 font-mono font-semibold text-slate-900 dark:text-slate-100">
                    {editRecord.nis} / {editRecord.nisn}
                  </p>
                </div>
                <div>
                  <label className="text-slate-500 dark:text-slate-400">Jenis Kelamin</label>
                  <select
                    disabled={!canEdit}
                    value={editRecord.gender || 'Laki-laki'}
                    onChange={(e) => setEditRecord({ ...editRecord, gender: e.target.value })}
                    className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2 py-1.5"
                  >
                    <option value="Laki-laki">Laki-laki</option>
                    <option value="Perempuan">Perempuan</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-500 dark:text-slate-400">Agama</label>
                  <select
                    disabled={!canEdit}
                    value={editRecord.religion || 'Islam'}
                    onChange={(e) => setEditRecord({ ...editRecord, religion: e.target.value })}
                    className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2 py-1.5"
                  >
                    <option value="Islam">Islam</option>
                    <option value="Kristen">Kristen</option>
                    <option value="Katolik">Katolik</option>
                    <option value="Hindu">Hindu</option>
                    <option value="Buddha">Buddha</option>
                    <option value="Konghucu">Konghucu</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-500 dark:text-slate-400">Tempat, Tanggal Lahir</label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      readOnly={!canEdit}
                      value={editRecord.birth_place}
                      onChange={(e) => setEditRecord({ ...editRecord, birth_place: e.target.value })}
                      className="w-1/2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2 py-1"
                    />
                    <input
                      type="date"
                      readOnly={!canEdit}
                      value={editRecord.birth_date}
                      onChange={(e) => setEditRecord({ ...editRecord, birth_date: e.target.value })}
                      className="w-1/2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2 py-1 font-mono"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-slate-500 dark:text-slate-400">Asal SMP/MTs</label>
                  <input
                    type="text"
                    readOnly={!canEdit}
                    value={editRecord.previous_school}
                    onChange={(e) => setEditRecord({ ...editRecord, previous_school: e.target.value })}
                    className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-1"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-slate-500 dark:text-slate-400">Alamat Rumah</label>
                  <input
                    type="text"
                    readOnly={!canEdit}
                    value={editRecord.address}
                    onChange={(e) => setEditRecord({ ...editRecord, address: e.target.value })}
                    className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-1"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs border-t border-slate-200 dark:border-slate-700 pt-4">
              <div className="space-y-1.5">
                <label className="text-slate-500 dark:text-slate-400 block">Nama &amp; Pekerjaan Ayah</label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    readOnly={!canEdit}
                    placeholder="Nama Ayah"
                    value={editRecord.father_name || ''}
                    onChange={(e) => setEditRecord({ ...editRecord, father_name: e.target.value })}
                    className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-2 py-1"
                  />
                  <input
                    type="text"
                    readOnly={!canEdit}
                    placeholder="Pekerjaan Ayah"
                    value={editRecord.father_job || ''}
                    onChange={(e) => setEditRecord({ ...editRecord, father_job: e.target.value })}
                    className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-2 py-1"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-slate-500 dark:text-slate-400 block">Nama &amp; Pekerjaan Ibu</label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    readOnly={!canEdit}
                    placeholder="Nama Ibu"
                    value={editRecord.mother_name || ''}
                    onChange={(e) => setEditRecord({ ...editRecord, mother_name: e.target.value })}
                    className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-2 py-1"
                  />
                  <input
                    type="text"
                    readOnly={!canEdit}
                    placeholder="Pekerjaan Ibu"
                    value={editRecord.mother_job || ''}
                    onChange={(e) => setEditRecord({ ...editRecord, mother_job: e.target.value })}
                    className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-2 py-1"
                  />
                </div>
              </div>
              <div>
                <label className="text-slate-500 dark:text-slate-400 block mb-1">Kontak Orang Tua</label>
                <input
                  type="text"
                  readOnly={!canEdit}
                  value={editRecord.parent_phone || ''}
                  onChange={(e) => setEditRecord({ ...editRecord, parent_phone: e.target.value })}
                  className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-1 font-mono"
                />
              </div>
              <div>
                <label className="text-slate-500 dark:text-slate-400 block mb-1">Kelas / Status Akademik</label>
                {editRecord.status === 'lulus' ? (
                  <p className="font-semibold text-teal-800 dark:text-teal-300 py-1">
                    LULUS ({editRecord.graduation_year}) · No Ijazah {editRecord.diploma_number || '-'}
                  </p>
                ) : (
                  <input
                    type="text"
                    readOnly={!canEdit}
                    value={editRecord.class_name || ''}
                    onChange={(e) => setEditRecord({ ...editRecord, class_name: e.target.value })}
                    className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1 font-semibold text-teal-800 dark:text-teal-300"
                  />
                )}
              </div>
            </div>

            {editRecord.status === 'lulus' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs border-t border-slate-200 dark:border-slate-700 pt-4">
                <div>
                  <label className="text-slate-500 dark:text-slate-400 block mb-1">Tahun Lulus</label>
                  <input
                    type="text"
                    readOnly={!canEdit}
                    value={editRecord.graduation_year || ''}
                    onChange={(e) => setEditRecord({ ...editRecord, graduation_year: e.target.value })}
                    className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-1 font-mono"
                  />
                </div>
                <div>
                  <label className="text-slate-500 dark:text-slate-400 block mb-1">Nomor Ijazah</label>
                  <input
                    type="text"
                    readOnly={!canEdit}
                    value={editRecord.diploma_number || ''}
                    onChange={(e) => setEditRecord({ ...editRecord, diploma_number: e.target.value })}
                    className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-1 font-mono"
                  />
                </div>
                <div>
                  <label className="text-slate-500 dark:text-slate-400 block mb-1">Studi Lanjut / Karier Alumni</label>
                  <input
                    type="text"
                    readOnly={!canEdit}
                    value={editRecord.alumni_destination || ''}
                    onChange={(e) => setEditRecord({ ...editRecord, alumni_destination: e.target.value })}
                    className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-1"
                  />
                </div>
                <div>
                  <label className="text-slate-500 dark:text-slate-400 block mb-1">Catatan Alumni</label>
                  <input
                    type="text"
                    readOnly={!canEdit}
                    value={editRecord.alumni_notes || ''}
                    onChange={(e) => setEditRecord({ ...editRecord, alumni_notes: e.target.value })}
                    className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-1"
                  />
                </div>
              </div>
            )}

            <div className="space-y-2 border-t border-slate-200 dark:border-slate-700 pt-4">
              <h4 className="font-display text-xs font-bold uppercase text-slate-700 dark:text-slate-300">
                Riwayat Kelas &amp; Nilai Per Semester
              </h4>
              <table className="w-full text-left text-xs border border-slate-200 dark:border-slate-700 border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400">
                    <th className="py-2 px-3">Tahun Ajaran</th>
                    <th className="py-2 px-3">Semester</th>
                    <th className="py-2 px-3">Kelas</th>
                    <th className="py-2 px-3 text-right">Rata-rata</th>
                    <th className="py-2 px-3 text-right">Peringkat</th>
                    <th className="py-2 px-3">Keterangan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                  {(editRecord.history || []).map((h: any) => (
                    <tr key={h.id}>
                      <td className="py-2 px-3 font-mono">{h.academic_year}</td>
                      <td className="py-2 px-3">{h.semester}</td>
                      <td className="py-2 px-3 font-semibold">{h.class_name}</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">{h.average_score}</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">#{h.rank_in_class}</td>
                      <td className="py-2 px-3">{h.status}</td>
                    </tr>
                  ))}
                  {(editRecord.history || []).length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-4 text-center text-slate-500 dark:text-slate-400">
                        Belum ada riwayat kenaikan/kelulusan semester yang tercatat.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUBTAB 2: KENAIKAN & KELULUSAN MASSAL */}
      {subTab === 'massal' && isAdmin && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
            <div>
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                Proses Massal Kenaikan Kelas &amp; Kelulusan
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Rata-rata &amp; peringkat dihitung otomatis dari nilai rapor. Siswa yang diproses <strong>Lulus</strong> akses loginnya dinonaktifkan permanen.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select
                value={batchAction}
                onChange={(e) => {
                  setBatchAction(e.target.value as any);
                  setConfirmBatchOpen(false);
                }}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 font-semibold"
              >
                <option value="promote">Naik Kelas Massal</option>
                <option value="graduate">Luluskan ke Alumni (Nonaktifkan Login)</option>
              </select>
              <input
                type="text"
                value={batchYear}
                onChange={(e) => setBatchYear(e.target.value)}
                placeholder="TA 2026/2027"
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 w-28 font-mono"
              />
              {batchAction === 'promote' ? (
                <input
                  type="text"
                  value={targetClass}
                  onChange={(e) => setTargetClass(e.target.value)}
                  placeholder="Kelas Tujuan"
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 w-28"
                />
              ) : (
                <input
                  type="text"
                  value={gradYear}
                  onChange={(e) => setGradYear(e.target.value)}
                  placeholder="Tahun Lulus"
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 w-24 font-mono"
                />
              )}
              <button
                type="button"
                disabled={selectedForBatch.length === 0}
                onClick={() => setConfirmBatchOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white hover:bg-teal-800 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <UserCheck className="h-4 w-4" />
                <span>Proses ({selectedForBatch.length} siswa)</span>
              </button>
            </div>
          </div>

          {confirmBatchOpen && selectedForBatch.length > 0 && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  {batchAction === 'graduate'
                    ? `Konfirmasi meluluskan ${selectedForBatch.length} siswa ke Alumni tahun ${gradYear}? Akun mereka akan langsung nonaktif.`
                    : `Konfirmasi menaikkan ${selectedForBatch.length} siswa ke kelas ${targetClass} (TA ${batchYear})?`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmBatchOpen(false)}
                  className="rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 px-3 py-1.5 font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={runBatchProcess}
                  className="rounded-lg bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 dark:hover:bg-slate-600 px-3 py-1.5 font-semibold text-white cursor-pointer"
                >
                  Ya, Jalankan Proses Massal
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <select
              value={batchClassFilter}
              onChange={(e) => setBatchClassFilter(e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-1.5 font-medium"
            >
              <option value="">Semua Kelas ({activeStudents.length} siswa aktif)</option>
              {activeClassList.map((cls) => (
                <option key={cls} value={cls}>
                  Kelas {cls}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                const visibleIds = batchFilteredActive.map((s) => s.id);
                const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedForBatch.includes(id));
                if (allSelected) {
                  setSelectedForBatch(selectedForBatch.filter((id) => !visibleIds.includes(id)));
                } else {
                  setSelectedForBatch(Array.from(new Set([...selectedForBatch, ...visibleIds])));
                }
              }}
              className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              Pilih / Batal Pilih Semua Tampil
            </button>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {batchFilteredActive.map((st) => {
              const checked = selectedForBatch.includes(st.id);
              return (
                <label key={st.id} className="py-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 px-2 rounded">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setSelectedForBatch(
                          e.target.checked ? [...selectedForBatch, st.id] : selectedForBatch.filter((id) => id !== st.id)
                        )
                      }
                    />
                    <img
                      src={st.photo_url}
                      alt={st.name}
                      referrerPolicy="no-referrer"
                      className="h-9 w-9 rounded-lg object-cover border border-slate-200 dark:border-slate-700"
                    />
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-slate-100">{st.name}</p>
                      <p className="text-slate-500 dark:text-slate-400">NIS {st.nis} · Kelas {st.class_name}</p>
                    </div>
                  </div>
                  <span className="text-emerald-700 dark:text-emerald-400 font-medium">Aktif</span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* SUBTAB 3: DIREKTORI ALUMNI */}
      {subTab === 'alumni' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Cari alumni, angkatan, atau kampus/karier..."
                value={alumniSearch}
                onChange={(e) => setAlumniSearch(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 pl-8 pr-3 py-2 text-xs"
              />
            </div>
            {user.role !== 'siswa' && (
              <button
                type="button"
                onClick={() => downloadAuthorizedFile('/api/buku-induk/alumni/export', 'direktori-alumni.xlsx')}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FileSpreadsheet className="h-4 w-4" />
                <span>Ekspor Alumni (.xlsx)</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredAlumni.map((al) => {
              const isEditing = editingAlumniId === al.id;
              return (
                <div key={al.id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-4 min-w-0">
                      <img
                        src={al.photo_url}
                        alt={al.name}
                        referrerPolicy="no-referrer"
                        className="h-16 w-16 rounded-xl object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                          <GraduationCap className="h-3.5 w-3.5 text-teal-700 dark:text-teal-400 shrink-0" />
                          <span>Alumni Angkatan {al.graduation_year || '2025'}</span>
                          <span>·</span>
                          <span className="font-mono">Login Dinonaktifkan</span>
                        </div>
                        <h4 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 mt-0.5 truncate">{al.name}</h4>
                        <p className="text-xs text-slate-600 dark:text-slate-400 font-mono">
                          NIS {al.nis} · Ijazah: {al.diploma_number || '-'}
                        </p>
                      </div>
                    </div>
                    {canEdit && !isEditing && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingAlumniId(al.id);
                          setAlumniForm({
                            graduationYear: al.graduation_year || '',
                            diplomaNumber: al.diploma_number || '',
                            alumniDestination: al.alumni_destination || '',
                            alumniNotes: al.alumni_notes || '',
                          });
                        }}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-[11px] font-semibold text-teal-800 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/60 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Edit Tracer
                      </button>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="space-y-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-3 text-xs">
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          placeholder="Angkatan Lulus"
                          value={alumniForm.graduationYear}
                          onChange={(e) => setAlumniForm({ ...alumniForm, graduationYear: e.target.value })}
                          className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 font-mono"
                        />
                        <input
                          type="text"
                          placeholder="Nomor Ijazah"
                          value={alumniForm.diplomaNumber}
                          onChange={(e) => setAlumniForm({ ...alumniForm, diplomaNumber: e.target.value })}
                          className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 font-mono"
                        />
                      </div>
                      <input
                        type="text"
                        placeholder="Studi Lanjut / Karier (mis. Teknik Informatika ITS)"
                        value={alumniForm.alumniDestination}
                        onChange={(e) => setAlumniForm({ ...alumniForm, alumniDestination: e.target.value })}
                        className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-2.5 py-1.5"
                      />
                      <input
                        type="text"
                        placeholder="Catatan alumni..."
                        value={alumniForm.alumniNotes}
                        onChange={(e) => setAlumniForm({ ...alumniForm, alumniNotes: e.target.value })}
                        className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-2.5 py-1.5"
                      />
                      <div className="flex justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setEditingAlumniId('')}
                          className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1 font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
                        >
                          Batal
                        </button>
                        <button
                          type="button"
                          onClick={() => saveAlumniTracer(al)}
                          className="rounded bg-teal-700 hover:bg-teal-800 px-3 py-1 font-semibold text-white cursor-pointer"
                        >
                          Simpan Tracer
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/70 rounded-lg p-3 space-y-1">
                      <p><strong className="text-slate-900 dark:text-slate-100">Studi Lanjut / Karier:</strong> {al.alumni_destination || '-'}</p>
                      <p><strong className="text-slate-900 dark:text-slate-100">Catatan:</strong> {al.alumni_notes || '-'}</p>
                    </div>
                  )}
                </div>
              );
            })}
            {filteredAlumni.length === 0 && (
              <p className="md:col-span-2 text-center py-8 text-xs text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                Tidak ada data alumni yang sesuai pencarian.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
