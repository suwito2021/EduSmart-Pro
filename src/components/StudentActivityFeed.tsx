import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  ClipboardCheck,
  FileCheck2,
  RefreshCw,
  ScanFace,
  Video,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { NavSection, StudentActivityFeedResponse, StudentActivityItem } from '../types';

type FeedFilter = 'all' | 'tugas' | 'cbt' | 'lainnya';

interface StudentActivityFeedProps {
  onNavigate: (section: NavSection) => void;
}

const INITIAL_VISIBLE = 6;

function formatRelativeOrDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin >= 0 && diffMin < 1) return 'Baru saja';
  if (diffMin >= 1 && diffMin < 60) return `${diffMin} mnt lalu`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour >= 1 && diffHour < 24) return `${diffHour} jam lalu`;

  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function toneTextClass(tone: StudentActivityItem['statusTone']): string {
  switch (tone) {
    case 'emerald':
      return 'text-emerald-700 dark:text-emerald-400';
    case 'amber':
      return 'text-amber-700 dark:text-amber-400';
    case 'teal':
      return 'text-teal-700 dark:text-teal-400';
    case 'red':
      return 'text-red-700 dark:text-red-400';
    default:
      return 'text-slate-600 dark:text-slate-400';
  }
}

function CategoryIcon({ category }: { category: StudentActivityItem['category'] }) {
  switch (category) {
    case 'cbt':
      return <ClipboardCheck className="h-4 w-4 text-teal-700 dark:text-teal-400" />;
    case 'tugas':
      return <FileCheck2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />;
    case 'materi':
      return <BookOpen className="h-4 w-4 text-sky-700 dark:text-sky-400" />;
    case 'online':
      return <Video className="h-4 w-4 text-indigo-700 dark:text-indigo-400" />;
    case 'absensi':
      return <ScanFace className="h-4 w-4 text-amber-700 dark:text-amber-400" />;
  }
}

function categoryActionLabel(category: StudentActivityItem['category']): string {
  switch (category) {
    case 'cbt':
      return 'Lihat Ujian';
    case 'tugas':
    case 'materi':
      return 'Buka E-Learning';
    case 'online':
      return 'Kelas Online';
    case 'absensi':
      return 'Riwayat Absen';
  }
}

export function StudentActivityFeed({ onNavigate }: StudentActivityFeedProps) {
  const [data, setData] = useState<StudentActivityFeedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [showAll, setShowAll] = useState(false);

  const loadFeed = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const res = await apiFetch<StudentActivityFeedResponse>('/api/student/activity-feed');
      setData(res);
    } catch (err: any) {
      setError(err?.message || 'Gagal memuat aktivitas terbaru.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadFeed(false);
  }, [loadFeed]);

  const filteredItems = useMemo(() => {
    const all = data?.items || [];
    if (filter === 'all') return all;
    if (filter === 'cbt') return all.filter((i) => i.category === 'cbt');
    if (filter === 'tugas') return all.filter((i) => i.category === 'tugas');
    return all.filter((i) => i.category === 'materi' || i.category === 'online' || i.category === 'absensi');
  }, [data, filter]);

  const visibleItems = showAll ? filteredItems : filteredItems.slice(0, INITIAL_VISIBLE);
  const counts = data?.counts || { all: 0, cbt: 0, tugas: 0, lainnya: 0 };

  const filterTabs: Array<{ id: FeedFilter; label: string; count: number }> = [
    { id: 'all', label: 'Semua', count: counts.all },
    { id: 'tugas', label: 'Tugas', count: counts.tugas },
    { id: 'cbt', label: 'Ujian CBT', count: counts.cbt },
    { id: 'lainnya', label: 'Kehadiran & Materi', count: counts.lainnya },
  ];

  return (
    <section
      aria-labelledby="student-activity-feed-heading"
      className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden"
    >
      {/* Header & Segmented Filter */}
      <div className="px-5 sm:px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/70 flex items-center justify-center shrink-0 mt-0.5">
            <Activity className="h-4 w-4 text-teal-700 dark:text-teal-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2
                id="student-activity-feed-heading"
                className="font-display text-lg font-bold text-slate-900 dark:text-slate-100"
              >
                Activity Feed
              </h2>
              <button
                type="button"
                onClick={() => loadFeed(true)}
                disabled={loading || refreshing}
                aria-label="Muat ulang aktivitas"
                title="Muat ulang aktivitas"
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Riwayat tugas dikumpulkan, penilaian guru, ujian CBT selesai, dan presensi terbaru Anda.
            </p>
          </div>
        </div>

        <div
          role="tablist"
          aria-label="Filter jenis aktivitas"
          className="inline-flex flex-wrap items-center gap-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 p-1 self-start md:self-auto"
        >
          {filterTabs.map((tab) => {
            const active = filter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setFilter(tab.id);
                  setShowAll(false);
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-semibold shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <span>{tab.label}</span>
                <span className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="divide-y divide-slate-100 dark:divide-slate-800" aria-busy="true">
          {[1, 2, 3].map((idx) => (
            <div key={idx} className="px-5 sm:px-6 py-4 flex items-center justify-between gap-4 animate-pulse">
              <div className="flex items-center gap-3.5 min-w-0 flex-1">
                <div className="h-9 w-9 rounded-lg bg-slate-200 dark:bg-slate-800 shrink-0" />
                <div className="space-y-2 flex-1 max-w-md">
                  <div className="h-3.5 w-2/3 rounded bg-slate-200 dark:bg-slate-800" />
                  <div className="h-3 w-1/2 rounded bg-slate-100 dark:bg-slate-800/70" />
                </div>
              </div>
              <div className="h-5 w-16 rounded bg-slate-100 dark:bg-slate-800/70 shrink-0" />
            </div>
          ))}
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <div className="px-5 sm:px-6 py-8 text-center space-y-3">
          <p className="text-sm font-medium text-red-700 dark:text-red-400">{error}</p>
          <button
            type="button"
            onClick={() => loadFeed(false)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Coba Muat Ulang</span>
          </button>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && filteredItems.length === 0 && (
        <div className="px-5 sm:px-6 py-10 text-center space-y-3">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {filter === 'all'
              ? 'Belum ada aktivitas akademik tercatat.'
              : 'Belum ada aktivitas pada kategori ini.'}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            Saat Anda mengumpulkan tugas, menyelesaikan ujian CBT, membaca materi, atau melakukan presensi, riwayatnya akan tampil otomatis di sini.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            {filter !== 'all' ? (
              <button
                type="button"
                onClick={() => setFilter('all')}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Tampilkan Semua Kategori
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onNavigate('elearning')}
                  className="rounded-lg bg-teal-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-teal-800 cursor-pointer"
                >
                  Buka E-Learning
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('cbt')}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Lihat Ujian CBT
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Populated Activity Rows */}
      {!loading && !error && visibleItems.length > 0 && (
        <>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {visibleItems.map((item) => (
              <li
                key={item.id}
                className="group px-5 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
              >
                <div className="flex items-start gap-3.5 min-w-0">
                  <div className="h-9 w-9 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/70 flex items-center justify-center shrink-0 mt-0.5">
                    <CategoryIcon category={item.category} />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                      <span className={`font-semibold ${toneTextClass(item.statusTone)}`}>
                        {item.statusLabel}
                      </span>
                      <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                        ·
                      </span>
                      <span className="font-medium text-slate-700 dark:text-slate-300 truncate">
                        {item.subject}
                      </span>
                      <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                        ·
                      </span>
                      <time
                        dateTime={item.timestamp}
                        className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400"
                      >
                        {formatRelativeOrDate(item.timestamp)}
                      </time>
                    </div>

                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                      {item.title}
                    </p>

                    {item.detail && (
                      <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">
                        {item.detail}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-4 pl-12 sm:pl-0 shrink-0">
                  {item.scoreLabel !== null && (
                    <div className="sm:text-right">
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">Nilai</p>
                      <p className="font-mono tabular-nums text-base font-bold text-slate-900 dark:text-slate-100">
                        {item.scoreLabel}
                        {item.scoreMax ? (
                          <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                            /{item.scoreMax}
                          </span>
                        ) : null}
                      </p>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => onNavigate(item.targetSection)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-teal-600 dark:hover:border-teal-500 hover:text-teal-700 dark:hover:text-teal-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <span>{categoryActionLabel(item.category)}</span>
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {filteredItems.length > INITIAL_VISIBLE && (
            <div className="px-5 sm:px-6 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/60 flex items-center justify-between text-xs">
              <span className="text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                Menampilkan {visibleItems.length} dari {filteredItems.length} aktivitas
              </span>
              <button
                type="button"
                onClick={() => setShowAll((prev) => !prev)}
                className="font-semibold text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
              >
                {showAll ? 'Tampilkan lebih sedikit' : `Lihat semua (${filteredItems.length})`}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
