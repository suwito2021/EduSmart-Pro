export type SchoolTimezone = 'Asia/Jakarta' | 'Asia/Makassar' | 'Asia/Jayapura';

export function getSchoolNowParts(timezone: string = 'Asia/Jakarta'): {
  dateStr: string;
  timeStr: string;
  minutesOfDay: number;
  epochMs: number;
} {
  const tz = ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'].includes(timezone)
    ? timezone
    : 'Asia/Jakarta';

  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = fmt.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '00';
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hourNum = Number(get('hour')) % 24;
  const minNum = Number(get('minute'));
  const secNum = Number(get('second'));

  const hour = String(hourNum).padStart(2, '0');
  const minute = String(minNum).padStart(2, '0');
  const second = String(secNum).padStart(2, '0');

  const dateStr = `${year}-${month}-${day}`;
  const timeStr = `${hour}:${minute}`;
  // Compute UTC-equivalent epoch for comparing school-local YYYY-MM-DDTHH:mm:ss reliably regardless of host OS timezone
  const epochMs = Date.UTC(Number(year), Number(month) - 1, Number(day), hourNum, minNum, secNum);

  return {
    dateStr,
    timeStr,
    minutesOfDay: hourNum * 60 + minNum,
    epochMs,
  };
}

export function parseSchoolLocalDateTimeMs(dateStr: string, timeStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  return Date.UTC(y || 2026, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0);
}

export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
