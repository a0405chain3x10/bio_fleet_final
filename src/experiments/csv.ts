/** Minimal CSV writer (numbers rounded to 3 decimals). */
export function toCsv<T extends object>(rows: T[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]) as (keyof T)[];
  const cell = (v: unknown): string => {
    if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : '';
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}
