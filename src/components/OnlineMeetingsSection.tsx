import React, { useEffect, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  Plus,
  Printer,
  Trash2,
  Users,
  Video,
  AlertCircle,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { MeetingItem, User } from '../types';

interface OnlineMeetingsSectionProps {
  user: User;
  compactTodayOnly?: boolean;
}

function validateMeetInputClient(raw: string): { valid: boolean; normalized: string; message: string } {
  const val = raw.trim();
  if (!val) return { valid: false, normalized: '', message: '' };
  const codeRx = /^([a-z]{3}-[a-z]{4}-[a-z]{3})$/i;
  if (codeRx.test(val)) {
    const code = val.toLowerCase();
    return { valid: true, normalized: `https://meet.google.com/${code}`, message: `Kode valid: https://meet.google.com/${code}` };
  }
  try {
    const url = new URL(val);
    if (url.hostname === 'meet.google.com') {
      const slug = url.pathname.replace(/^\/+/, '').split('/')[0];
      if (codeRx.test(slug)) {
        return { valid: true, normalized: `https://meet.google.com/${slug.toLowerCase()}`, message: 'Tautan Google Meet valid.' };
      }
    }
  } catch {
    /* invalid URL */
  }
  return {
    valid: false,
    normalized: '',
    message: 'Tautan salah: hanya tautan Google Meet (meet.google.com/abc-defg-hij) atau kode abc-defg-hij yang diterima.',
  };
}

export function OnlineMeetingsSection({ user, compactTodayOnly = false }: OnlineMeetingsSectionProps) {
  const isStudent = user.role === 'siswa';
  const [meetings, setMeetings] = useState<MeetingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Teacher Create Form
  const todayStr = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    title: '',
    subject: 'Matematika Wajib',
    className: 'XII-IPA-1',
    meetingDate: todayStr,
    startTime: '08:00',
    endTime: '09:30',
    meetInput: '',
    repeatWeeks: 1,
    weeklyRepeat: false,
  });

  // Attendance Drawer
  const [attendanceModal, setAttendanceModal] = useState<{
    meeting: any;
    attendees: Array<{ id: string; student_name: string; class_name: string; joined_at: string }>;
  } | null>(null);

  async function loadMeetings() {
    setLoading(true);
    try {
      const data = await apiFetch<MeetingItem[]>('/api/meetings');
      setMeetings(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMeetings();
  }, [user.id]);

  const meetCheck = validateMeetInputClient(form.meetInput);

  async function handleCreateMeeting(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    if (!meetCheck.valid) {
      setErrorMsg(meetCheck.message || 'Masukkan tautan atau kode Google Meet yang valid.');
      return;
    }
    try {
      const res = await apiFetch<{ createdCount: number }>('/api/meetings', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title,
          subject: form.subject,
          className: form.className,
          meetingDate: form.meetingDate,
          startTime: form.startTime,
          endTime: form.endTime,
          meetInput: form.meetInput,
          repeatWeeks: form.weeklyRepeat ? form.repeatWeeks : 1,
        }),
      });
      setForm({ ...form, title: '', meetInput: '', weeklyRepeat: false, repeatWeeks: 1 });
      setNotice(`${res.createdCount} jadwal Tatap Muka Google Meet berhasil dibuat.`);
      loadMeetings();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal menjadwalkan pertemuan.');
    }
  }

  async function handleJoinMeeting(m: MeetingItem) {
    setErrorMsg('');
    try {
      const res = await apiFetch<{ meetUrl: string }>(`/api/meetings/${m.id}/join`, {
        method: 'POST',
      });
      setNotice(`Kehadiran tercatat otomatis untuk "${m.title}". Membuka Google Meet...`);
      await loadMeetings();
      // Open Google Meet via clean anchor dispatch without window.open
      const a = document.createElement('a');
      a.href = res.meetUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Tidak dapat bergabung ke kelas online.');
    }
  }

  async function openAttendance(meetingId: string) {
    const data = await apiFetch<any>(`/api/meetings/${meetingId}/attendance`);
    setAttendanceModal(data);
  }

  const displayedMeetings = compactTodayOnly
    ? meetings.filter((m) => m.meeting_date === todayStr)
    : meetings;

  return (
    <div className="space-y-6">
      {!compactTodayOnly && (
        <div>
          <h3 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
            {isStudent ? 'Tatap Muka Online (Google Meet)' : 'Jadwal Tatap Muka Online (Google Meet)'}
          </h3>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
            {isStudent
              ? 'Tombol Gabung aktif 15 menit sebelum kelas dimulai dan kehadiran Anda tercatat otomatis saat menekan Gabung.'
              : 'Buat ruang Google Meet, jadwalkan hingga 16 minggu rutin, dan pantau daftar hadir siswa. Guru hanya mengelola pertemuannya sendiri.'}
          </p>
        </div>
      )}

      {notice && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 px-4 py-2.5 text-xs text-emerald-800 dark:text-emerald-300 flex items-center justify-between">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} className="font-semibold cursor-pointer">
            Tutup
          </button>
        </div>
      )}
      {errorMsg && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 px-4 py-2.5 text-xs text-red-800 dark:text-red-300 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Teacher / Admin Scheduler Form */}
      {!isStudent && !compactTodayOnly && (
        <form onSubmit={handleCreateMeeting} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">Jadwalkan Pertemuan Google Meet</h4>
            <a
              href="https://meet.google.com/new"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-teal-700 dark:border-teal-600 bg-teal-50 dark:bg-teal-950/60 px-3.5 py-2 text-xs font-semibold text-teal-800 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/60 transition-colors"
            >
              <Video className="h-3.5 w-3.5" />
              <span>Buat baru di Google Meet</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              type="text"
              required
              placeholder="Judul Pertemuan"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 text-sm"
            />
            <input
              type="text"
              required
              placeholder="Mata Pelajaran"
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 text-sm"
            />
            <select
              value={form.className}
              onChange={(e) => setForm({ ...form, className: e.target.value })}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm"
            >
              <option value="XII-IPA-1">Kelas XII-IPA-1</option>
              <option value="XII-IPA-2">Kelas XII-IPA-2</option>
              <option value="XI-IPA-1">Kelas XI-IPA-1</option>
              <option value="X-1">Kelas X-1</option>
            </select>

            <input
              type="date"
              required
              value={form.meetingDate}
              onChange={(e) => setForm({ ...form, meetingDate: e.target.value })}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm font-mono"
            />
            <div className="flex items-center gap-2">
              <input
                type="time"
                required
                value={form.startTime}
                onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm font-mono"
              />
              <span className="text-xs text-slate-400 dark:text-slate-500">s/d</span>
              <input
                type="time"
                required
                value={form.endTime}
                onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm font-mono"
              />
            </div>

            <div className="space-y-1">
              <input
                type="text"
                required
                placeholder="Tempel link Meet atau kode (abc-defg-hij)"
                value={form.meetInput}
                onChange={(e) => setForm({ ...form, meetInput: e.target.value })}
                className={`w-full rounded-lg border px-3 py-2 text-sm ${
                  form.meetInput && !meetCheck.valid
                    ? 'border-red-400 dark:border-red-700 bg-red-50 dark:bg-red-950/50 text-red-900 dark:text-red-200'
                    : form.meetInput && meetCheck.valid
                    ? 'border-emerald-500 dark:border-emerald-600 bg-emerald-50/40 dark:bg-emerald-950/40 text-slate-900 dark:text-slate-100'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500'
                }`}
              />
              {form.meetInput && (
                <p className={`text-[11px] ${meetCheck.valid ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400 font-medium'}`}>
                  {meetCheck.message}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <label className="inline-flex items-center gap-2 cursor-pointer font-medium text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={form.weeklyRepeat}
                  onChange={(e) => setForm({ ...form, weeklyRepeat: e.target.checked })}
                />
                <span>Ulangi mingguan (tautan sama)</span>
              </label>
              {form.weeklyRepeat && (
                <label className="inline-flex items-center gap-2">
                  <span className="text-slate-600 dark:text-slate-400">Jumlah minggu (maks 16):</span>
                  <input
                    type="number"
                    min={2}
                    max={16}
                    value={form.repeatWeeks}
                    onChange={(e) => setForm({ ...form, repeatWeeks: Math.min(16, Math.max(2, Number(e.target.value))) })}
                    className="w-16 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2 py-1 font-mono tabular-nums"
                  />
                </label>
              )}
            </div>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Simpan Jadwal Pertemuan</span>
            </button>
          </div>
        </form>
      )}

      {/* Meetings Cards */}
      {loading ? (
        <div className="h-28 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse" />
      ) : displayedMeetings.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-center text-sm text-slate-500 dark:text-slate-400">
          {compactTodayOnly ? 'Tidak ada kelas online yang dijadwalkan hari ini.' : 'Belum ada pertemuan tatap muka online.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {displayedMeetings.map((m) => (
            <div key={m.id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span>
                    {m.subject} · {m.class_name}
                  </span>
                  <span className="font-mono tabular-nums">{m.meet_code}</span>
                </div>
                <h4 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">{m.title}</h4>
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    <span className="font-mono tabular-nums">{m.meeting_date}</span>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    <span className="font-mono tabular-nums">
                      {m.start_time}–{m.end_time}
                    </span>
                  </span>
                  <span>· {m.teacher_name}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                {isStudent ? (
                  <>
                    <div className="text-xs">
                      {m.state === 'terbuka' ? (
                        <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                          {m.joinedByMe ? 'Hadir Tercatat · Dibuka' : `Dibuka sejak ${m.opensAtLabel}`}
                        </span>
                      ) : m.state === 'belum_dibuka' ? (
                        <span className="text-amber-700 dark:text-amber-400 font-medium">Buka pukul {m.opensAtLabel}</span>
                      ) : (
                        <span className="text-slate-500 dark:text-slate-400">Selesai pada {m.end_time}</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleJoinMeeting(m)}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                        m.canJoin
                          ? 'bg-teal-700 text-white hover:bg-teal-800'
                          : 'border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      <Video className="h-3.5 w-3.5" />
                      <span>Gabung</span>
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => openAttendance(m.id)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-800 dark:text-teal-400 hover:underline cursor-pointer"
                    >
                      <Users className="h-3.5 w-3.5" />
                      <span className="font-mono tabular-nums">Daftar Hadir ({m.attendanceCount})</span>
                    </button>
                    <div className="flex items-center gap-2">
                      <a
                        href={m.meet_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <span>Buka Meet</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      <button
                        type="button"
                        onClick={async () => {
                          await apiFetch(`/api/meetings/${m.id}`, { method: 'DELETE' });
                          loadMeetings();
                        }}
                        className="p-1.5 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 cursor-pointer"
                        aria-label="Hapus jadwal"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Printable Attendance Modal */}
      {attendanceModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-slate-950/75 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 max-w-2xl w-full p-6 space-y-4 print-page">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
              <div>
                <h4 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                  Daftar Hadir Tatap Muka Online
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  {attendanceModal.meeting.title} · {attendanceModal.meeting.class_name} ·{' '}
                  {attendanceModal.meeting.meeting_date} ({attendanceModal.meeting.start_time}–
                  {attendanceModal.meeting.end_time})
                </p>
              </div>
              <div className="flex items-center gap-2 no-print">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 dark:hover:bg-slate-600 px-3 py-1.5 text-xs font-semibold text-white cursor-pointer"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>Cetak</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAttendanceModal(null)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Tutup
                </button>
              </div>
            </div>

            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300">
                  <th className="py-2 px-3">No</th>
                  <th className="py-2 px-3">Nama Siswa</th>
                  <th className="py-2 px-3">Kelas</th>
                  <th className="py-2 px-3">Jam Bergabung</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {attendanceModal.attendees.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-500 dark:text-slate-400">
                      Belum ada siswa yang menekan tombol Gabung.
                    </td>
                  </tr>
                ) : (
                  attendanceModal.attendees.map((a, idx) => (
                    <tr key={a.id}>
                      <td className="py-2 px-3 font-mono text-slate-700 dark:text-slate-300">{idx + 1}</td>
                      <td className="py-2 px-3 font-medium text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                        <span>{a.student_name}</span>
                      </td>
                      <td className="py-2 px-3 text-slate-700 dark:text-slate-300">{a.class_name}</td>
                      <td className="py-2 px-3 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {new Date(a.joined_at).toLocaleTimeString('id-ID', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
