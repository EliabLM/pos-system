/**
 * Business time helpers.
 *
 * POS Ágil runs only in Colombia: every store uses America/Bogota as its
 * business time zone (user decision 13). The server process may run in any
 * zone (UTC in containers), so never rely on `Date#getHours`, date-fns
 * `startOfDay`, or `toISOString().slice(0, 10)` to decide "which day" a sale
 * or purchase belongs to. Use these helpers instead.
 *
 * All helpers are pure and independent of `process.env.TZ`.
 */

export const BUSINESS_TIME_ZONE = 'America/Bogota';

export type BusinessPeriod = 'hour' | 'day' | 'week' | 'month' | 'year';

export interface BusinessDateParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const pad = (value: number, length = 2): string => String(value).padStart(length, '0');

/** Wall-clock parts of an instant in the business time zone. */
export function getBusinessDateParts(date: Date): BusinessDateParts {
  const parts: Record<string, number> = {};
  for (const part of partsFormatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

/** Offset (ms) of the business zone at `date`: wall clock minus UTC. */
function businessOffsetMs(date: Date): number {
  const p = getBusinessDateParts(date);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const truncated = date.getTime() - date.getUTCMilliseconds();
  return wallAsUtc - truncated;
}

/**
 * Instant for a wall-clock time in the business zone. Month is 1-12; day,
 * hour, etc. may overflow (Date.UTC normalizes them).
 */
export function businessDateTime(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0
): Date {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  // Two passes handle zones with DST transitions; Bogota has a fixed offset.
  let instant = wallAsUtc - businessOffsetMs(new Date(wallAsUtc));
  instant = wallAsUtc - businessOffsetMs(new Date(instant));
  return new Date(instant);
}

/** Business day of an instant as `YYYY-MM-DD`. */
export function businessDayKey(date: Date): string {
  const p = getBusinessDateParts(date);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/**
 * Resolves a report/filter boundary to a business day key. A date-only string
 * (`YYYY-MM-DD`) is taken literally as that business day; anything else is an
 * instant whose business day is used.
 */
export function toBusinessDayKey(value: Date | string): string {
  if (typeof value === 'string') {
    if (DATE_ONLY.test(value)) return value;
    return businessDayKey(new Date(value));
  }
  return businessDayKey(value);
}

function keyToParts(key: string): [number, number, number] {
  const match = DATE_ONLY.exec(key);
  if (!match) throw new Error(`Fecha inválida: ${key}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** First instant (00:00:00.000) of the business day containing `value`. */
export function startOfBusinessDay(value: Date | string = new Date()): Date {
  const [y, m, d] = keyToParts(toBusinessDayKey(value));
  return businessDateTime(y, m, d);
}

/** Last instant (23:59:59.999) of the business day containing `value`. */
export function endOfBusinessDay(value: Date | string = new Date()): Date {
  const [y, m, d] = keyToParts(toBusinessDayKey(value));
  return new Date(businessDateTime(y, m, d + 1).getTime() - 1);
}

/** First instant of the business month containing `value`. */
export function startOfBusinessMonth(value: Date | string = new Date()): Date {
  const [y, m] = keyToParts(toBusinessDayKey(value));
  return businessDateTime(y, m, 1);
}

/** Last instant of the business month containing `value`. */
export function endOfBusinessMonth(value: Date | string = new Date()): Date {
  const [y, m] = keyToParts(toBusinessDayKey(value));
  return new Date(businessDateTime(y, m + 1, 1).getTime() - 1);
}

/** Same wall-clock time `days` business days later (negative = earlier). */
export function addBusinessDays(date: Date, days: number): Date {
  const p = getBusinessDateParts(date);
  return businessDateTime(
    p.year,
    p.month,
    p.day + days,
    p.hour,
    p.minute,
    p.second,
    date.getUTCMilliseconds()
  );
}

/**
 * Inclusive business-day range for a filter: from the start of the first
 * business day to the end of the last one. Use it for `gte`/`lte` filters.
 */
export function businessDayRange(
  start: Date | string,
  end: Date | string = start
): { gte: Date; lte: Date } {
  return { gte: startOfBusinessDay(start), lte: endOfBusinessDay(end) };
}

/**
 * Grouping key of an instant in the business zone:
 * hour `YYYY-MM-DD HH:00`, day `YYYY-MM-DD`, week (Monday) `YYYY-MM-DD`,
 * month `YYYY-MM-01`, year `YYYY-01-01`.
 */
export function businessPeriodKey(date: Date, period: BusinessPeriod): string {
  const p = getBusinessDateParts(date);
  switch (period) {
    case 'hour':
      return `${businessDayKey(date)} ${pad(p.hour)}:00`;
    case 'week': {
      const wall = new Date(Date.UTC(p.year, p.month - 1, p.day));
      const sinceMonday = (wall.getUTCDay() + 6) % 7;
      const monday = new Date(wall.getTime() - sinceMonday * MS_PER_DAY);
      return monday.toISOString().slice(0, 10);
    }
    case 'month':
      return `${pad(p.year, 4)}-${pad(p.month)}-01`;
    case 'year':
      return `${pad(p.year, 4)}-01-01`;
    case 'day':
    default:
      return businessDayKey(date);
  }
}

/** Compact business day for document numbers: `YYYYMMDD`. */
export function businessDayCompact(date: Date): string {
  return businessDayKey(date).replace(/-/g, '');
}

/** Formats an instant in the business zone (Spanish, Colombia). */
export function formatBusinessDate(
  date: Date,
  options: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit' }
): string {
  return new Intl.DateTimeFormat('es-CO', { ...options, timeZone: BUSINESS_TIME_ZONE }).format(date);
}
