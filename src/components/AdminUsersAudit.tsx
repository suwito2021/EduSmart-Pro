import React, { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  Download,
  History,
  KeyRound,
  Plus,
  Search,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';
import { apiFetch, downloadAuthorizedFile } from '../lib/api';

interface AdminUserRow {
  id: string;
  username: string;
  name: string;
  role: 'admin' | 'guru' | 'pengawas' | 'wali_kelas' | 'siswa';
  class_name: string;
  homeroom_class: string;
  status: 'aktif' | 'lulus' | 'nonaktif';
  email: string;
  phone: string;
  created_at: string;
}

interface AuditLogRow {
  id: string;
  actor_id: string;
  actor_name: string;
  actor_role: string;
  action: string;
  target_type: string;
  target_id: string;
  detail: string;
  ip_address: string;
  created_at: string;
}

export function AdminUsersAudit() {
  const [tab, setTab] = useState<'users' | 'audit'>('users');
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [auditFilter, setAuditFilter] = useState('');
  const [notice, setNotice] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Create / Edit User form
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    username: '',
    name: '',
    role: 'siswa' as AdminUserRow['role'],
    className: 'XII-IPA-1',
    homeroomClass: '',
    status: 'aktif' as AdminUserRow['status'],
    email: '',
    phone: '',
    password: '',
  });

  async function loadUsers() {
    const params = new URLSearchParams();
    if (roleFilter) params.set('role', roleFilter);
    if (search.trim()) params.set('q', search.trim());
    const data = await apiFetch<AdminUserRow[]>(`/api/admin/users?${params.toString()}`);
    setUsers(data);
  }

  async function loadAuditLogs() {
    const data = await apiFetch<AuditLogRow[]>('/api/admin/audit-logs');
    setLogs(data);
  }

  useEffect(() => {
    if (tab === 'users') loadUsers();
    else loadAuditLogs();
  }, [tab, roleFilter]);

  function openCreate() {
    setEditingId(null);
    setForm({
      username: '',
      name: '',
      role: 'siswa',
      className: 'XII-IPA-1',
      homeroomClass: '',
      status: 'aktif',
      email: '',
      phone: '',
      password: 'Password123',
    });
    setShowForm(true);
    setErrorMsg('');
  }

  function openEdit(u: AdminUserRow) {
    setEditingId(u.id);
    setForm({
      username: u.username,
      name: u.name,
      role: u.role,
      className: u.class_name || '',
      homeroomClass: u.homeroom_class || '',
      status: u.status,
      email: u.email || '',
      phone: u.phone || '',
      password: '',
    });
    setShowForm(true);
    setErrorMsg('');
  }

  async function submitUserForm(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    setNotice('');
    try {
      const payload: any = {
        username: form.username,
        name: form.name,
        role: form.role,
        className: form.className,
        homeroomClass: form.homeroomClass,
        status: form.status,
        email: form.email,
        phone: form.phone,
      };
      if (form.password.trim()) {
        payload.password = form.password.trim();
      }
      if (editingId) {
        await apiFetch(`/api/admin/users/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setNotice(`Data pengguna ${form.name} diperbarui.`);
      } else {
        await apiFetch('/api/admin/users', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setNotice(`Pengguna baru ${form.name} berhasil ditambahkan.`);
      }
      setShowForm(false);
      await loadUsers();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal menyimpan data pengguna.');
    }
  }

  async function handleExcelImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErrorMsg('');
    setNotice('');
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const firstSheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet);
      const res = await apiFetch<{ createdCount: number; skippedCount: number; errors: string[] }>(
        '/api/admin/users/import',
        {
          method: 'POST',
          body: JSON.stringify({ rows }),
        }
      );
      setNotice(
        `Impor massal selesai: ${res.createdCount} akun ditambahkan, ${res.skippedCount} dilewati.${
          res.errors.length > 0 ? ` Catatan: ${res.errors.slice(0, 2).join('; ')}` : ''
        }`
      );
      await loadUsers();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal membaca atau mengimpor berkas Excel/CSV.');
    }
  }

  const filteredLogs = logs.filter((l) => {
    if (!auditFilter.trim()) return true;
    const q = auditFilter.toLowerCase();
    return (
      l.action.toLowerCase().includes(q) ||
      l.actor_name.toLowerCase().includes(q) ||
      l.detail.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">Manajemen Pengguna &amp; Audit Keamanan</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Kelola akun siswa/guru/pengawas, impor massal Excel, reset kata sandi, dan pantau rekam jejak aktivitas portal.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
          <button
            type="button"
            onClick={() => setTab('users')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
              tab === 'users'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            <span>Akun &amp; Impor Massal</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('audit')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
              tab === 'audit'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            <History className="h-3.5 w-3.5" />
            <span>Audit Log</span>
          </button>
        </div>
      </div>

      {notice && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 px-4 py-2.5 text-xs sm:text-sm text-emerald-800 dark:text-emerald-300">
          {notice}
        </div>
      )}
      {errorMsg && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 px-4 py-2.5 text-xs sm:text-sm text-red-800 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {tab === 'users' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[240px]">
              <div className="relative flex-1 min-w-[180px] max-w-xs">
                <Search className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Cari nama, NIS, atau kelas..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') loadUsers();
                  }}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 pl-8 pr-3 py-2 text-xs"
                />
              </div>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-xs"
              >
                <option value="">Semua Peran</option>
                <option value="siswa">Siswa</option>
                <option value="guru">Guru</option>
                <option value="wali_kelas">Wali Kelas</option>
                <option value="pengawas">Pengawas</option>
                <option value="admin">Admin</option>
              </select>
              <button
                type="button"
                onClick={loadUsers}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cari
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  downloadAuthorizedFile('/api/admin/users/template', 'template-impor-pengguna.xlsx')
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Unduh Template Excel</span>
              </button>

              <label className="inline-flex items-center gap-1.5 rounded-lg border border-teal-700 dark:border-teal-600 bg-teal-50 dark:bg-teal-950/60 px-3 py-2 text-xs font-semibold text-teal-800 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/60 cursor-pointer">
                <Upload className="h-3.5 w-3.5" />
                <span>Impor Excel / CSV</span>
                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelImport} className="hidden" />
              </label>

              <button
                type="button"
                onClick={openCreate}
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-teal-800 cursor-pointer"
              >
                <UserPlus className="h-3.5 w-3.5" />
                <span>Tambah Akun</span>
              </button>
            </div>
          </div>

          {showForm && (
            <form
              onSubmit={submitUserForm}
              className="rounded-xl border border-teal-200 dark:border-teal-800 bg-white dark:bg-slate-900 p-5 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  {editingId ? 'Edit Data Akun & Reset Sandi' : 'Buat Akun Pengguna Baru'}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                >
                  Tutup
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Username / NIS</label>
                  <input
                    required
                    type="text"
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Nama Lengkap</label>
                  <input
                    required
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Peran</label>
                  <select
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value as AdminUserRow['role'] })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2"
                  >
                    <option value="siswa">Siswa</option>
                    <option value="guru">Guru</option>
                    <option value="wali_kelas">Wali Kelas</option>
                    <option value="pengawas">Pengawas</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Kelas (jika siswa)</label>
                  <input
                    type="text"
                    placeholder="mis. XII-IPA-1"
                    value={form.className}
                    onChange={(e) => setForm({ ...form, className: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Status Akun</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value as AdminUserRow['status'] })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2"
                  >
                    <option value="aktif">Aktif</option>
                    <option value="nonaktif">Nonaktif</option>
                    <option value="lulus">Lulus (Alumni)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {editingId ? 'Reset Kata Sandi (opsional)' : 'Kata Sandi Awal'}
                  </label>
                  <input
                    type="password"
                    minLength={editingId ? 0 : 6}
                    placeholder={editingId ? 'Kosongkan jika tidak diubah' : 'Minimal 6 karakter'}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>{editingId ? 'Simpan Perubahan' : 'Daftarkan Akun'}</span>
                </button>
              </div>
            </form>
          )}

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300">
                  <th className="py-2.5 px-4">Username / NIS</th>
                  <th className="py-2.5 px-4">Nama Lengkap</th>
                  <th className="py-2.5 px-4">Peran</th>
                  <th className="py-2.5 px-4">Kelas</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="py-2.5 px-4 font-mono text-slate-800 dark:text-slate-200">{u.username}</td>
                    <td className="py-2.5 px-4 font-medium text-slate-900 dark:text-slate-100">{u.name}</td>
                    <td className="py-2.5 px-4 text-slate-600 dark:text-slate-400">{u.role}</td>
                    <td className="py-2.5 px-4 text-slate-600 dark:text-slate-400">{u.class_name || u.homeroom_class || '-'}</td>
                    <td className="py-2.5 px-4">
                      <span
                        className={`font-semibold ${
                          u.status === 'aktif'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : u.status === 'lulus'
                            ? 'text-slate-500 dark:text-slate-400'
                            : 'text-red-700 dark:text-red-400'
                        }`}
                      >
                        {u.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => openEdit(u)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        <KeyRound className="h-3 w-3" />
                        <span>Edit / Sandi</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Filter aksi, pelaku, atau detail log..."
                value={auditFilter}
                onChange={(e) => setAuditFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 pl-8 pr-3 py-2 text-xs"
              />
            </div>
            <button
              type="button"
              onClick={loadAuditLogs}
              className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              Muat Ulang Log
            </button>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300">
                  <th className="py-2.5 px-4">Waktu (UTC)</th>
                  <th className="py-2.5 px-4">Aksi</th>
                  <th className="py-2.5 px-4">Pelaku</th>
                  <th className="py-2.5 px-4">Detail Aktivitas</th>
                  <th className="py-2.5 px-4">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredLogs.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2.5 px-4 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap tabular-nums">
                      {l.created_at.replace('T', ' ').slice(0, 19)}
                    </td>
                    <td className="py-2.5 px-4 font-mono font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                      {l.action}
                    </td>
                    <td className="py-2.5 px-4 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {l.actor_name} <span className="text-slate-400 dark:text-slate-500">· {l.actor_role}</span>
                    </td>
                    <td className="py-2.5 px-4 text-slate-600 dark:text-slate-400">{l.detail}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-400 dark:text-slate-500 whitespace-nowrap">{l.ip_address || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
