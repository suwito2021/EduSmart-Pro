import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Save, Check, Image as ImageIcon } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { LoginSlide } from '../types';

const PRESET_IMAGES = [
  { label: 'Ruang Ujian CBT', url: '/src/assets/images/slide_cbt_campus_1794936322664.jpg' },
  { label: 'Perpustakaan & E-Learning', url: '/src/assets/images/slide_elearning_library_1794936323273.jpg' },
  { label: 'Laboratorium Sains', url: '/src/assets/images/slide_science_lab_1794936324310.jpg' },
];

export function AdminSlidesManager() {
  const [slides, setSlides] = useState<LoginSlide[]>([]);
  const [loading, setLoading] = useState(true);
  const [savedNotice, setSavedNotice] = useState('');
  const [newSlide, setNewSlide] = useState({
    title: '',
    subtitle: '',
    tag: 'Pengumuman Sekolah',
    imageUrl: PRESET_IMAGES[0].url,
    sortOrder: 4,
    isActive: true,
  });

  async function loadSlides() {
    setLoading(true);
    try {
      const data = await apiFetch<LoginSlide[]>('/api/admin/slides');
      setSlides(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSlides();
  }, []);

  async function handleAddSlide(e: React.FormEvent) {
    e.preventDefault();
    await apiFetch('/api/admin/slides', {
      method: 'POST',
      body: JSON.stringify(newSlide),
    });
    setNewSlide({
      title: '',
      subtitle: '',
      tag: 'Pengumuman Sekolah',
      imageUrl: PRESET_IMAGES[0].url,
      sortOrder: slides.length + 1,
      isActive: true,
    });
    setSavedNotice('Slide baru berhasil ditambahkan ke halaman login.');
    loadSlides();
  }

  async function handleUpdateSlide(slide: LoginSlide) {
    await apiFetch(`/api/admin/slides/${slide.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        title: slide.title,
        subtitle: slide.subtitle,
        tag: slide.tag,
        imageUrl: slide.image_url,
        accentColor: slide.accent_color,
        sortOrder: slide.sort_order,
        isActive: Boolean(slide.is_active),
      }),
    });
    setSavedNotice(`Perubahan pada "${slide.title}" disimpan.`);
    loadSlides();
  }

  async function handleDelete(id: string) {
    await apiFetch(`/api/admin/slides/${id}`, { method: 'DELETE' });
    setSavedNotice('Slide dihapus.');
    loadSlides();
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">Pengaturan Slider Halaman Login</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Atur judul, deskripsi, gambar latar, urutan, dan status aktif slide yang tampil bersama motif kelopak logo.
          </p>
        </div>
        {savedNotice && (
          <div className="flex items-center gap-2 text-xs font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2">
            <Check className="h-4 w-4" />
            <span>{savedNotice}</span>
          </div>
        )}
      </div>

      {/* Add New Slide */}
      <form onSubmit={handleAddSlide} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
        <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">Tambah Slide Baru</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Judul Slide</label>
            <input
              type="text"
              required
              value={newSlide.title}
              onChange={(e) => setNewSlide({ ...newSlide, title: e.target.value })}
              placeholder="Contoh: Jadwal Penilaian Akhir Semester 2026"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Kategori / Kicker</label>
            <input
              type="text"
              value={newSlide.tag}
              onChange={(e) => setNewSlide({ ...newSlide, tag: e.target.value })}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm"
            />
          </div>
          <div className="md:col-span-2 space-y-1">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Subjudul / Keterangan</label>
            <textarea
              rows={2}
              required
              value={newSlide.subtitle}
              onChange={(e) => setNewSlide({ ...newSlide, subtitle: e.target.value })}
              placeholder="Informasi singkat yang tampil pada slider..."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Pilih Gambar Latar</label>
            <select
              value={newSlide.imageUrl}
              onChange={(e) => setNewSlide({ ...newSlide, imageUrl: e.target.value })}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            >
              {PRESET_IMAGES.map((img) => (
                <option key={img.url} value={img.url}>
                  {img.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Urutan Tampil</label>
            <input
              type="number"
              min={1}
              value={newSlide.sortOrder}
              onChange={(e) => setNewSlide({ ...newSlide, sortOrder: Number(e.target.value) })}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm font-mono tabular-nums"
            />
          </div>
        </div>
        <button
          type="submit"
          className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          <span>Tambah Slide</span>
        </button>
      </form>

      {/* Existing Slides */}
      <div className="space-y-4">
        {loading ? (
          <div className="h-32 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse" />
        ) : (
          slides.map((sl) => (
            <div
              key={sl.id}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col lg:flex-row gap-5 items-start"
            >
              <div className="w-full lg:w-56 h-32 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800 shrink-0 relative">
                <img
                  src={sl.image_url}
                  alt={sl.title}
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
                <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-slate-900/75 px-2 py-0.5 text-[11px] text-white">
                  <ImageIcon className="h-3 w-3" />
                  <span className="font-mono tabular-nums">#{sl.sort_order}</span>
                </div>
              </div>

              <div className="flex-1 w-full space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input
                    type="text"
                    value={sl.title}
                    onChange={(e) =>
                      setSlides((prev) => prev.map((x) => (x.id === sl.id ? { ...x, title: e.target.value } : x)))
                    }
                    className="md:col-span-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-1.5 text-sm font-medium"
                  />
                  <input
                    type="text"
                    value={sl.tag}
                    onChange={(e) =>
                      setSlides((prev) => prev.map((x) => (x.id === sl.id ? { ...x, tag: e.target.value } : x)))
                    }
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-1.5 text-sm"
                  />
                </div>
                <textarea
                  rows={2}
                  value={sl.subtitle}
                  onChange={(e) =>
                    setSlides((prev) => prev.map((x) => (x.id === sl.id ? { ...x, subtitle: e.target.value } : x)))
                  }
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-200"
                />
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="flex items-center gap-4 text-xs text-slate-700 dark:text-slate-300">
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(sl.is_active)}
                        onChange={(e) =>
                          setSlides((prev) =>
                            prev.map((x) => (x.id === sl.id ? { ...x, is_active: e.target.checked ? 1 : 0 } : x))
                          )
                        }
                        className="rounded border-slate-300 dark:border-slate-600 text-teal-700"
                      />
                      <span>Aktif di halaman login</span>
                    </label>
                    <label className="inline-flex items-center gap-1.5">
                      <span>Urutan:</span>
                      <input
                        type="number"
                        min={1}
                        value={sl.sort_order}
                        onChange={(e) =>
                          setSlides((prev) =>
                            prev.map((x) => (x.id === sl.id ? { ...x, sort_order: Number(e.target.value) } : x))
                          )
                        }
                        className="w-16 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2 py-1 font-mono tabular-nums"
                      />
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleUpdateSlide(sl)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 cursor-pointer"
                    >
                      <Save className="h-3.5 w-3.5" />
                      <span>Simpan</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(sl.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 px-3 py-1.5 text-xs font-semibold text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Hapus</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
