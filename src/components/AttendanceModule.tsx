import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Eye,
  FileSpreadsheet,
  MapPin,
  ScanFace,
  Settings,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { apiFetch, downloadAuthorizedFile, uploadFileToServer } from '../lib/api';
import {
  captureVideoSnapshotFile,
  cosineSimilarity,
  extractFaceDescriptorFromVideo,
} from '../lib/faceDescriptor';
import type { User } from '../types';

interface AttendanceModuleProps {
  user: User;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export function AttendanceModule({ user }: AttendanceModuleProps) {
  const isStudent = user.role === 'siswa';
  const isAdmin = user.role === 'admin';
  const [subTab, setSubTab] = useState<'face' | 'kiosk' | 'rekap' | 'settings'>(
    isStudent ? 'face' : 'rekap'
  );

  const [settings, setSettings] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [summaryRows, setSummaryRows] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [classFilter, setClassFilter] = useState('');
  const [notice, setNotice] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [busyAction, setBusyAction] = useState(false);

  // Face status (Student)
  const [faceStatus, setFaceStatus] = useState<{
    enrolled: boolean;
    today: string;
    todayLog: any | null;
  }>({ enrolled: false, today: '', todayLog: null });

  // Camera & Blink Liveness state
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [blinkDetected, setBlinkDetected] = useState(false);
  const [livenessProgress, setLivenessProgress] = useState(0);
  const [geoState, setGeoState] = useState<{
    lat: number | null;
    lng: number | null;
    distance: number | null;
    insideArea: boolean;
    message: string;
  }>({ lat: null, lng: null, distance: null, insideArea: false, message: 'Belum dicek' });

  // Kiosk State
  const [kioskStudentId, setKioskStudentId] = useState('');
  const [kioskMode, setKioskMode] = useState<'masuk' | 'pulang'>('masuk');
  const [kioskMatchInfo, setKioskMatchInfo] = useState<{
    studentId: string;
    name: string;
    scorePct: number;
    descriptor: number[];
  } | null>(null);

  // Manual S/I/A State
  const [manualForm, setManualForm] = useState({
    studentId: '',
    date: new Date().toISOString().slice(0, 10),
    status: 'Sakit',
    note: '',
  });

  async function loadData() {
    const classQuery = classFilter ? `&className=${encodeURIComponent(classFilter)}` : '';
    const requests: Promise<any>[] = [
      apiFetch<any>('/api/attendance/settings'),
      apiFetch<any[]>(`/api/attendance/logs?month=${month}${classQuery}`),
      apiFetch<any>(`/api/attendance/summary?month=${month}${classQuery}`),
    ];
    if (isStudent) {
      requests.push(apiFetch<any>('/api/attendance/face-status'));
    }

    const [sett, logRows, summaryData, fStatus] = await Promise.all(requests);
    setSettings(sett);
    setLogs(logRows);
    setSummaryRows(summaryData?.rows || []);
    if (fStatus) {
      setFaceStatus(fStatus);
    }
    if (!isStudent) {
      const sts = await apiFetch<any[]>('/api/users?role=siswa');
      const activeSts = sts.filter((s) => s.status === 'aktif');
      setStudents(activeSts);
      if (activeSts.length > 0 && !kioskStudentId) {
        setKioskStudentId(activeSts[0].id);
        setManualForm((m) => ({ ...m, studentId: activeSts[0].id }));
      }
    }
  }

  useEffect(() => {
    loadData();
  }, [month, classFilter, user.id]);

  // Cleanup camera on unmount or tab switch
  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }

  useEffect(() => {
    return () => stopCamera();
  }, [subTab]);

  async function startCamera() {
    setErrorMsg('');
    setBlinkDetected(false);
    setLivenessProgress(0);
    setKioskMatchInfo(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
    } catch {
      setErrorMsg(
        'Kamera tidak dapat diakses pada perangkat/browser ini. Pastikan izin kamera diaktifkan.'
      );
    }
  }

  // Real-time Canvas Blink Liveness Analyzer (tracks eye-band luminance dip + recovery)
  useEffect(() => {
    if (!cameraActive || subTab !== 'face' || blinkDetected) return;

    let baselineAvg: number | null = null;
    let dipped = false;
    let frameCount = 0;

    const timer = setInterval(() => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) return;

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      const w = 160;
      const h = 120;
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);

      // Eye region ROI (center-upper face)
      const img = ctx.getImageData(48, 32, 64, 24);
      const data = img.data;
      let lumSum = 0;
      let prevLum = 0;
      let motionSum = 0;
      for (let i = 0; i < data.length; i += 4) {
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        lumSum += lum;
        if (i > 0) motionSum += Math.abs(lum - prevLum);
        prevLum = lum;
      }
      const avgLum = lumSum / (data.length / 4);
      const textureScore = motionSum / (data.length / 4);
      frameCount++;

      // Ensure live camera isn't pitch-black/covered
      if (avgLum > 18 && textureScore > 1.2) {
        if (baselineAvg === null) {
          baselineAvg = avgLum;
        } else {
          const delta = Math.abs(avgLum - baselineAvg);
          if (delta > 3.2) {
            dipped = true;
            setLivenessProgress(70);
          } else if (dipped) {
            setLivenessProgress(100);
            setBlinkDetected(true);
          } else {
            baselineAvg = baselineAvg * 0.9 + avgLum * 0.1;
            setLivenessProgress((p) => Math.min(60, Math.max(p, frameCount * 4)));
          }
        }
      }
    }, 140);

    return () => clearInterval(timer);
  }, [cameraActive, subTab, blinkDetected]);

  function checkGeolocation() {
    setErrorMsg('');
    if (!navigator.geolocation) {
      setGeoState({
        lat: null,
        lng: null,
        distance: null,
        insideArea: false,
        message: 'Browser tidak mendukung GPS Geolocation.',
      });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        if (settings) {
          const dist = haversineMeters(lat, lng, settings.school_lat, settings.school_lng);
          const inside = dist <= settings.radius_meters;
          setGeoState({
            lat,
            lng,
            distance: dist,
            insideArea: inside,
            message: inside
              ? `Di dalam area sekolah (${dist} m dari titik pusat, batas ${settings.radius_meters} m)`
              : `Di luar area sekolah (${dist} m dari titik pusat, batas ${settings.radius_meters} m)`,
          });
        }
      },
      (err) => {
        setGeoState({
          lat: null,
          lng: null,
          distance: null,
          insideArea: false,
          message: `Gagal membaca GPS (${err.message}). Aktifkan izin lokasi.`,
        });
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  async function enrollCurrentFace(targetStudentId?: string) {
    setErrorMsg('');
    setNotice('');
    if (!videoRef.current || !cameraActive) {
      setErrorMsg('Aktifkan kamera terlebih dahulu untuk mendaftarkan profil wajah.');
      return;
    }
    const descriptor = extractFaceDescriptorFromVideo(videoRef.current);
    if (!descriptor) {
      setErrorMsg('Wajah belum terbaca jelas oleh kamera. Pastikan pencahayaan cukup.');
      return;
    }

    setBusyAction(true);
    try {
      let photoUrl = '';
      const snapFile = await captureVideoSnapshotFile(videoRef.current, 'face-enroll');
      if (snapFile) {
        const up = await uploadFileToServer(snapFile);
        photoUrl = up.url;
      }
      await apiFetch('/api/attendance/enroll-face', {
        method: 'POST',
        body: JSON.stringify({
          studentId: targetStudentId,
          faceDescriptor: descriptor,
          photoUrl,
          updateAvatar: Boolean(photoUrl),
        }),
      });
      setNotice('Profil biometrik wajah berhasil didaftarkan dan disimpan ke server.');
      await loadData();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal mendaftarkan profil wajah.');
    } finally {
      setBusyAction(false);
    }
  }

  async function submitMobileFaceAttendance(mode: 'masuk' | 'pulang') {
    setErrorMsg('');
    setNotice('');
    setBusyAction(true);
    try {
      const descriptor = videoRef.current && cameraActive ? extractFaceDescriptorFromVideo(videoRef.current) : null;
      let photoUrl = '';
      if (videoRef.current && cameraActive) {
        const snapFile = await captureVideoSnapshotFile(videoRef.current, 'absen-hp');
        if (snapFile) {
          try {
            const up = await uploadFileToServer(snapFile);
            photoUrl = up.url;
          } catch {
            /* upload optional */
          }
        }
      }

      const res = await apiFetch<any>('/api/attendance/face-checkin', {
        method: 'POST',
        body: JSON.stringify({
          livenessBlinkVerified: blinkDetected,
          lat: geoState.lat,
          lng: geoState.lng,
          mode,
          faceDescriptor: descriptor || undefined,
          photoUrl,
        }),
      });

      const matchText = res.matchScore != null ? `, kecocokan wajah ${res.matchScore}%` : '';
      if (res.alreadyCheckedIn) {
        setNotice(`Anda sudah tercatat ${res.status} hari ini pukul ${res.time} (jarak ${res.distanceMeters} m${matchText}).`);
      } else {
        setNotice(
          `Absensi ${res.status} tercatat pukul ${res.time} (jarak ${res.distanceMeters} m dari sekolah${matchText}).`
        );
      }
      stopCamera();
      await loadData();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Absensi gagal.');
    } finally {
      setBusyAction(false);
    }
  }

  function scanAndMatchKioskFace() {
    setErrorMsg('');
    setNotice('');
    if (!videoRef.current || !cameraActive) {
      setErrorMsg('Buka kamera kiosk terlebih dahulu sebelum memindai wajah.');
      return;
    }
    const probe = extractFaceDescriptorFromVideo(videoRef.current);
    if (!probe) {
      setErrorMsg('Wajah belum terdeteksi jelas di kamera kiosk.');
      return;
    }

    let bestStudent: any = null;
    let bestSim = -1;
    for (const st of students) {
      if (!st.face_descriptor_json) continue;
      try {
        const vec = JSON.parse(st.face_descriptor_json);
        const sim = cosineSimilarity(probe, vec);
        if (sim > bestSim) {
          bestSim = sim;
          bestStudent = st;
        }
      } catch {
        /* ignore invalid descriptor */
      }
    }

    if (!bestStudent) {
      setErrorMsg('Belum ada profil wajah siswa yang terdaftar. Pilih siswa manual lalu tekan Daftarkan Wajah.');
      return;
    }

    const scorePct = Math.round(Math.max(0, Math.min(1, bestSim)) * 100);
    setKioskStudentId(bestStudent.id);
    setKioskMatchInfo({
      studentId: bestStudent.id,
      name: bestStudent.name,
      scorePct,
      descriptor: probe,
    });
    if (scorePct >= 74) {
      setNotice(`Kandidat wajah dikenali: ${bestStudent.name} (${bestStudent.class_name}) — kecocokan ${scorePct}%.`);
    } else {
      setErrorMsg(`Kecocokan terbaik hanya ${scorePct}% (${bestStudent.name}). Pastikan siswa menghadap kamera atau pilih manual.`);
    }
  }

  async function submitKioskCheckin() {
    setErrorMsg('');
    setBusyAction(true);
    try {
      let photoUrl = '';
      let descriptor = kioskMatchInfo?.descriptor;
      if (videoRef.current && cameraActive) {
        if (!descriptor) {
          descriptor = extractFaceDescriptorFromVideo(videoRef.current) || undefined;
        }
        const snapFile = await captureVideoSnapshotFile(videoRef.current, 'kiosk');
        if (snapFile) {
          try {
            const up = await uploadFileToServer(snapFile);
            photoUrl = up.url;
          } catch {
            /* optional */
          }
        }
      }
      const res = await apiFetch<any>('/api/attendance/kiosk-checkin', {
        method: 'POST',
        body: JSON.stringify({
          studentId: kioskStudentId,
          mode: kioskMode,
          faceDescriptor: descriptor,
          photoUrl,
        }),
      });
      const matchText = res.matchScore != null ? ` · Kecocokan wajah ${res.matchScore}%` : '';
      setNotice(`Kiosk Gerbang: ${res.studentName} (${res.className}) tercatat ${res.status} pukul ${res.time}${matchText}.`);
      setKioskMatchInfo(null);
      await loadData();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal mencatat kiosk.');
    } finally {
      setBusyAction(false);
    }
  }

  const classOptions = Array.from(new Set(students.map((s) => s.class_name).filter(Boolean))).sort();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">Absensi Wajah &amp; Kehadiran</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Verifikasi wajah berkedip + GPS area sekolah, mode kiosk gerbang, input S/I/A manual, dan ekspor Excel bulanan.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg overflow-x-auto">
          {isStudent && (
            <button
              type="button"
              onClick={() => setSubTab('face')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
                subTab === 'face'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Absen Wajah HP
            </button>
          )}
          {!isStudent && (
            <button
              type="button"
              onClick={() => setSubTab('kiosk')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
                subTab === 'kiosk'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Kiosk Gerbang Sekolah
            </button>
          )}
          <button
            type="button"
            onClick={() => setSubTab('rekap')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
              subTab === 'rekap'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            {isStudent ? 'Riwayat Kehadiran' : 'Rekap & Manual S/I/A'}
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setSubTab('settings')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
                subTab === 'settings'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Lokasi &amp; Jam Sekolah
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 px-4 py-2.5 text-xs sm:text-sm text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}
      {errorMsg && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 px-4 py-2.5 text-xs sm:text-sm text-red-800 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* STUDENT MOBILE FACE + BLINK + GPS ATTENDANCE */}
      {subTab === 'face' && isStudent && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-3 text-slate-700 dark:text-slate-300">
              <span>
                Status Hari Ini ({faceStatus.today || 'Hari ini'}):{' '}
                <strong className="text-slate-900 dark:text-slate-100">
                  {faceStatus.todayLog
                    ? `${faceStatus.todayLog.status} (Masuk ${faceStatus.todayLog.check_in_time || '-'} · Pulang ${faceStatus.todayLog.check_out_time || '-'})`
                    : 'Belum absen hari ini'}
                </strong>
              </span>
              <span className="text-slate-300 dark:text-slate-600">·</span>
              <span className={faceStatus.enrolled ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-amber-700 dark:text-amber-400 font-semibold'}>
                {faceStatus.enrolled
                  ? 'Profil biometrik wajah terdaftar'
                  : 'Profil wajah belum terdaftar (otomatis terdaftar pada absensi pertama)'}
              </span>
            </div>
            {cameraActive && (
              <button
                type="button"
                disabled={busyAction}
                onClick={() => enrollCurrentFace()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-teal-700 dark:border-teal-600 bg-teal-50 dark:bg-teal-950/60 px-3 py-1.5 text-xs font-semibold text-teal-800 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/60 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                <UserPlus className="h-3.5 w-3.5" />
                <span>{faceStatus.enrolled ? 'Perbarui Profil Wajah' : 'Daftarkan Profil Wajah'}</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">1. Kamera Wajah &amp; Kedipan Mata</h3>
                {!cameraActive ? (
                  <button
                    type="button"
                    onClick={startCamera}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Camera className="h-4 w-4" />
                    <span>Aktifkan Kamera</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Matikan Kamera
                  </button>
                )}
              </div>

              <div className="relative aspect-[4/3] w-full rounded-xl overflow-hidden bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center">
                <video ref={videoRef} playsInline muted className="h-full w-full object-cover scale-x-[-1]" />
                <canvas ref={canvasRef} className="hidden" />

                {!cameraActive && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-300 gap-2 p-4 text-center">
                    <ScanFace className="h-10 w-10 text-teal-400" />
                    <p className="text-sm font-medium">
                      Tekan &quot;Aktifkan Kamera&quot; lalu berkedip sekali untuk verifikasi liveness &amp; pencocokan wajah
                    </p>
                  </div>
                )}

                {cameraActive && (
                  <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-between p-4">
                    <div className="rounded-lg bg-slate-900/75 px-3 py-1.5 text-xs text-white flex items-center gap-2">
                      <Eye className="h-4 w-4 text-teal-400" />
                      <span>
                        {blinkDetected
                          ? 'Kedipan mata terverifikasi (Wajah asli)'
                          : `Silakan berkedip secara alami (${livenessProgress}%)`}
                      </span>
                    </div>
                    <div
                      className={`h-48 w-36 rounded-full border-2 ${
                        blinkDetected ? 'border-emerald-400' : 'border-white/70 border-dashed'
                      }`}
                    />
                    <div className="h-1.5 w-48 rounded-full bg-white/20 overflow-hidden">
                      <div
                        className={`h-full transition-all ${blinkDetected ? 'bg-emerald-400' : 'bg-teal-400'}`}
                        style={{ width: `${blinkDetected ? 100 : livenessProgress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="lg:col-span-5 space-y-4">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">2. Verifikasi Lokasi Area Sekolah</h3>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Lokasi harus berada dalam radius{' '}
                  <strong className="font-mono tabular-nums text-slate-900 dark:text-slate-200">{settings?.radius_meters || 250} m</strong> dari{' '}
                  {settings?.school_name || 'Sekolah'}.
                </p>

                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-3 text-xs space-y-1">
                  <p className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-teal-700 dark:text-teal-400" />
                    <span>Status Lokasi:</span>
                  </p>
                  <p className={geoState.insideArea ? 'text-emerald-700 dark:text-emerald-400 font-medium' : 'text-slate-700 dark:text-slate-300'}>
                    {geoState.message}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={checkGeolocation}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Periksa Koordinat GPS Sekarang
                </button>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">3. Catat Kehadiran</h3>
                <div className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
                  <p>
                    Jam Masuk: <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200">{settings?.entry_time}</span> (Toleransi{' '}
                    <span className="tabular-nums">{settings?.late_tolerance_min}</span> menit)
                  </p>
                  <p>
                    Jam Pulang: <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200">{settings?.checkout_time}</span>
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() => submitMobileFaceAttendance('masuk')}
                    className="rounded-xl bg-teal-700 py-2.5 text-xs font-semibold text-white hover:bg-teal-800 cursor-pointer disabled:opacity-50"
                  >
                    Absen Masuk
                  </button>
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() => submitMobileFaceAttendance('pulang')}
                    className="rounded-xl bg-slate-900 dark:bg-slate-700 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-slate-600 cursor-pointer disabled:opacity-50"
                  >
                    Absen Pulang
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* GATE KIOSK MODE (Teacher / Admin Tablet at School Gate) */}
      {subTab === 'kiosk' && !isStudent && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">Kiosk Kamera Gerbang Sekolah</h3>
              <button
                type="button"
                onClick={cameraActive ? stopCamera : startCamera}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-slate-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-slate-600 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Camera className="h-3.5 w-3.5" />
                <span>{cameraActive ? 'Matikan Kamera' : 'Buka Kamera Gerbang'}</span>
              </button>
            </div>
            <div className="relative aspect-[4/3] w-full rounded-xl overflow-hidden bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center">
              <video ref={videoRef} playsInline muted className="h-full w-full object-cover scale-x-[-1]" />
              {!cameraActive && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-300 text-xs gap-2 p-4 text-center">
                  <ScanFace className="h-10 w-10 text-teal-400" />
                  <span>Kamera Kiosk Gerbang Siap Mengenali Siswa Bergantian</span>
                </div>
              )}
              {cameraActive && (
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className="h-44 w-36 rounded-full border-2 border-dashed border-teal-400/80" />
                </div>
              )}
            </div>
            {cameraActive && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={scanAndMatchKioskFace}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-800 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <ScanFace className="h-4 w-4" />
                  <span>Pindai &amp; Cocokkan Wajah Otomatis</span>
                </button>
                {kioskStudentId && (
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() => enrollCurrentFace(kioskStudentId)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    <span>Daftarkan Wajah Siswa Ini</span>
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="lg:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">Pencocokan Profil Wajah Siswa</h3>
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-3">
              <select
                value={kioskStudentId}
                onChange={(e) => {
                  setKioskStudentId(e.target.value);
                  setKioskMatchInfo(null);
                }}
                className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm min-w-0"
              >
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {s.class_name} (NIS {s.username}) {s.face_enrolled ? '[Wajah Terdaftar]' : ''}
                  </option>
                ))}
              </select>
              <select
                value={kioskMode}
                onChange={(e) => setKioskMode(e.target.value as any)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm"
              >
                <option value="masuk">Masuk / Terlambat</option>
                <option value="pulang">Pulang</option>
              </select>
            </div>

            {students.find((s) => s.id === kioskStudentId) && (
              <div className="flex items-center gap-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-4">
                <img
                  src={students.find((s) => s.id === kioskStudentId)?.photo_url}
                  alt="Pas foto siswa"
                  referrerPolicy="no-referrer"
                  className="h-20 w-20 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                />
                <div className="space-y-1 text-xs min-w-0">
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                    {students.find((s) => s.id === kioskStudentId)?.name}
                  </p>
                  <p className="text-slate-600 dark:text-slate-400">
                    Kelas {students.find((s) => s.id === kioskStudentId)?.class_name} · NIS{' '}
                    <span className="font-mono">{students.find((s) => s.id === kioskStudentId)?.username}</span>
                  </p>
                  <p className={students.find((s) => s.id === kioskStudentId)?.face_enrolled ? 'text-teal-700 dark:text-teal-400 font-medium' : 'text-amber-700 dark:text-amber-400 font-medium'}>
                    {kioskMatchInfo && kioskMatchInfo.studentId === kioskStudentId
                      ? `Hasil Pindai Kamera: Kecocokan ${kioskMatchInfo.scorePct}%`
                      : students.find((s) => s.id === kioskStudentId)?.face_enrolled
                      ? 'Profil biometrik wajah terdaftar · Siap konfirmasi kiosk'
                      : 'Belum ada vektor wajah · Aktifkan kamera & tekan "Daftarkan Wajah" atau catat langsung'}
                  </p>
                </div>
              </div>
            )}

            <button
              type="button"
              disabled={busyAction || !kioskStudentId}
              onClick={submitKioskCheckin}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-teal-700 py-3 text-sm font-semibold text-white hover:bg-teal-800 cursor-pointer disabled:opacity-50"
            >
              <UserCheck className="h-4 w-4" />
              <span>Konfirmasi Wajah &amp; Catat Absen Kiosk</span>
            </button>
          </div>
        </div>
      )}

      {/* REKAP BULANAN + MANUAL S/I/A + EXPORT EXCEL */}
      {subTab === 'rekap' && (
        <div className="space-y-6">
          {!isStudent && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setErrorMsg('');
                try {
                  await apiFetch('/api/attendance/manual', {
                    method: 'POST',
                    body: JSON.stringify(manualForm),
                  });
                  setNotice('Status absensi manual disimpan.');
                  await loadData();
                } catch (err: any) {
                  setErrorMsg(err?.message || 'Gagal menyimpan absensi manual.');
                }
              }}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3"
            >
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">Catat Manual Sakit / Izin / Alpha (S/I/A)</h3>
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                <select
                  value={manualForm.studentId}
                  onChange={(e) => setManualForm({ ...manualForm, studentId: e.target.value })}
                  className="sm:col-span-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-xs"
                >
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.class_name})
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  value={manualForm.date}
                  onChange={(e) => setManualForm({ ...manualForm, date: e.target.value })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-xs font-mono"
                />
                <select
                  value={manualForm.status}
                  onChange={(e) => setManualForm({ ...manualForm, status: e.target.value })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-xs"
                >
                  <option value="Sakit">Sakit (S)</option>
                  <option value="Izin">Izin (I)</option>
                  <option value="Alpha">Alpha (A)</option>
                  <option value="Hadir">Hadir</option>
                </select>
                <button
                  type="submit"
                  className="rounded-lg bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 dark:hover:bg-slate-600 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
                >
                  Simpan S/I/A
                </button>
              </div>
              <input
                type="text"
                placeholder="Keterangan / alasan ketidakhadiran..."
                value={manualForm.note}
                onChange={(e) => setManualForm({ ...manualForm, note: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 text-xs"
              />
            </form>
          )}

          {/* REKAP RINGKASAN PER SISWA */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Bulan Rekap:</label>
                <input
                  type="month"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-1.5 text-xs font-mono"
                />
                {!isStudent && (
                  <select
                    value={classFilter}
                    onChange={(e) => setClassFilter(e.target.value)}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-1.5 text-xs font-medium"
                  >
                    <option value="">Semua Kelas</option>
                    {classOptions.map((c) => (
                      <option key={c} value={c}>
                        Kelas {c}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {!isStudent && (
                <button
                  type="button"
                  onClick={() =>
                    downloadAuthorizedFile(
                      `/api/attendance/export?month=${month}${classFilter ? `&className=${encodeURIComponent(classFilter)}` : ''}`,
                      `rekap-absensi-${month}${classFilter ? `-${classFilter}` : ''}.xlsx`
                    )
                  }
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  <span>Ekspor Rekap Bulanan Excel (.xlsx)</span>
                </button>
              )}
            </div>

            {summaryRows.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-display text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  Ringkasan Kehadiran Bulan {month}
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-400">
                        <th className="py-2 px-3">NIS</th>
                        <th className="py-2 px-3">Nama Siswa</th>
                        <th className="py-2 px-3">Kelas</th>
                        <th className="py-2 px-3 text-right">Hadir</th>
                        <th className="py-2 px-3 text-right">Terlambat</th>
                        <th className="py-2 px-3 text-right">Sakit</th>
                        <th className="py-2 px-3 text-right">Izin</th>
                        <th className="py-2 px-3 text-right">Alpha</th>
                        <th className="py-2 px-3 text-right">Kehadiran (%)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {summaryRows.map((row) => (
                        <tr key={row.studentId}>
                          <td className="py-2 px-3 font-mono tabular-nums text-slate-600 dark:text-slate-400">{row.nis}</td>
                          <td className="py-2 px-3 font-semibold text-slate-900 dark:text-slate-100">{row.name}</td>
                          <td className="py-2 px-3 text-slate-700 dark:text-slate-300">{row.className}</td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400 font-semibold">{row.hadir}</td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-amber-700 dark:text-amber-400">{row.terlambat}</td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">{row.sakit}</td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">{row.izin}</td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-red-700 dark:text-red-400">{row.alpha}</td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums font-bold text-slate-900 dark:text-slate-100">
                            {row.attendanceRate}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <h4 className="font-display text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                Log Kehadiran Harian
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-400">
                      <th className="py-2.5 px-3">Tanggal</th>
                      <th className="py-2.5 px-3">Nama Siswa</th>
                      <th className="py-2.5 px-3">Kelas</th>
                      <th className="py-2.5 px-3">Masuk</th>
                      <th className="py-2.5 px-3">Pulang</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Metode</th>
                      <th className="py-2.5 px-3 text-right">Wajah / Jarak</th>
                      <th className="py-2.5 px-3">Catatan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {logs.map((l) => (
                      <tr key={l.id}>
                        <td className="py-2.5 px-3 font-mono tabular-nums text-slate-700 dark:text-slate-300">{l.date}</td>
                        <td className="py-2.5 px-3 font-medium text-slate-900 dark:text-slate-100">{l.student_name}</td>
                        <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300">{l.class_name}</td>
                        <td className="py-2.5 px-3 font-mono tabular-nums text-slate-700 dark:text-slate-300">{l.check_in_time || '-'}</td>
                        <td className="py-2.5 px-3 font-mono tabular-nums text-slate-700 dark:text-slate-300">{l.check_out_time || '-'}</td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`font-semibold ${
                              l.status === 'Hadir' || l.status === 'Pulang'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : l.status === 'Terlambat'
                                ? 'text-amber-700 dark:text-amber-400'
                                : 'text-red-700 dark:text-red-400'
                            }`}
                          >
                            {l.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">
                          {l.method === 'face_mobile' ? 'Wajah HP' : l.method === 'kiosk' ? 'Kiosk Gerbang' : 'Manual'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                          {l.face_match_score != null ? `${l.face_match_score}%` : '-'} ·{' '}
                          {l.distance_meters != null ? `${l.distance_meters}m` : '-'}
                        </td>
                        <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400">{l.note || '-'}</td>
                      </tr>
                    ))}
                    {logs.length === 0 && (
                      <tr>
                        <td colSpan={9} className="py-6 text-center text-slate-500 dark:text-slate-400">
                          Belum ada catatan kehadiran pada bulan ini.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ADMIN SCHOOL LOCATION & HOURS SETTINGS */}
      {subTab === 'settings' && isAdmin && settings && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setErrorMsg('');
            try {
              await apiFetch('/api/attendance/settings', {
                method: 'PUT',
                body: JSON.stringify({
                  schoolName: settings.school_name,
                  schoolLat: settings.school_lat,
                  schoolLng: settings.school_lng,
                  radiusMeters: settings.radius_meters,
                  entryTime: settings.entry_time,
                  lateToleranceMin: settings.late_tolerance_min,
                  checkoutTime: settings.checkout_time,
                  timezone: settings.timezone || 'Asia/Jakarta',
                }),
              });
              setNotice('Pengaturan lokasi GPS, jam absensi, dan zona waktu sekolah disimpan.');
            } catch (err: any) {
              setErrorMsg(err?.message || 'Gagal menyimpan pengaturan sekolah.');
            }
          }}
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4 max-w-2xl"
        >
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Settings className="h-4 w-4 text-teal-700 dark:text-teal-400" />
              <span>Pengaturan Area, Jam &amp; Zona Waktu Sekolah</span>
            </h3>
            <button
              type="button"
              onClick={() => {
                navigator.geolocation?.getCurrentPosition((pos) => {
                  setSettings({
                    ...settings,
                    school_lat: Number(pos.coords.latitude.toFixed(6)),
                    school_lng: Number(pos.coords.longitude.toFixed(6)),
                  });
                });
              }}
              className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-teal-800 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/60 cursor-pointer"
            >
              Gunakan Koordinat Saya Saat Ini
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="sm:col-span-2">
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Nama Sekolah</label>
              <input
                type="text"
                value={settings.school_name}
                onChange={(e) => setSettings({ ...settings, school_name: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Latitude Sekolah</label>
              <input
                type="number"
                step="0.000001"
                value={settings.school_lat}
                onChange={(e) => setSettings({ ...settings, school_lat: Number(e.target.value) })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Longitude Sekolah</label>
              <input
                type="number"
                step="0.000001"
                value={settings.school_lng}
                onChange={(e) => setSettings({ ...settings, school_lng: Number(e.target.value) })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Radius Area (meter)</label>
              <input
                type="number"
                value={settings.radius_meters}
                onChange={(e) => setSettings({ ...settings, radius_meters: Number(e.target.value) })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Zona Waktu Sekolah</label>
              <select
                value={settings.timezone || 'Asia/Jakarta'}
                onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-xs font-medium"
              >
                <option value="Asia/Jakarta">WIB — Asia/Jakarta (UTC+7)</option>
                <option value="Asia/Makassar">WITA — Asia/Makassar (UTC+8)</option>
                <option value="Asia/Jayapura">WIT — Asia/Jayapura (UTC+9)</option>
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Jam Masuk / Toleransi (menit)</label>
              <div className="flex gap-2">
                <input
                  type="time"
                  value={settings.entry_time}
                  onChange={(e) => setSettings({ ...settings, entry_time: e.target.value })}
                  className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2 py-2 font-mono"
                />
                <input
                  type="number"
                  value={settings.late_tolerance_min}
                  onChange={(e) => setSettings({ ...settings, late_tolerance_min: Number(e.target.value) })}
                  className="w-20 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2 py-2 font-mono"
                />
              </div>
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Jam Pulang</label>
              <input
                type="time"
                value={settings.checkout_time}
                onChange={(e) => setSettings({ ...settings, checkout_time: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono"
              />
            </div>
          </div>
          <button
            type="submit"
            className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 cursor-pointer"
          >
            Simpan Pengaturan Sekolah
          </button>
        </form>
      )}
    </div>
  );
}
