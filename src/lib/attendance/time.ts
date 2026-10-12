const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export function getClubTimeZone(): string {
  const zone = process.env.CLUB_TIME_ZONE || "Asia/Shanghai";
  new Intl.DateTimeFormat("en", { timeZone: zone }).format(0);
  return zone;
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
}

function numbersAt(date: Date, format: Intl.DateTimeFormat) {
  const parts = Object.fromEntries(format.formatToParts(date).map((part) => [part.type, part.value]));
  return [parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second].map(Number);
}

export function isCalendarDate(date: string): boolean {
  if (date.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day;
}

export function isClockTime(time: string): boolean {
  return time.length === 5 && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
}

/** Reject rather than guess across a DST gap or a repeated local clock time. */
export function zonedLocalToUtc(date: string, time: string, timeZone = getClubTimeZone()): string {
  if (!isCalendarDate(date) || !isClockTime(time)) throw new RangeError("日期或时间格式不正确。");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallTimestamp = Date.UTC(year, month - 1, day, hour, minute);
  const format = formatter(timeZone);
  const offsets = new Set<number>();
  // Probe both sides of any nearby transition, including non-hour offsets.
  for (let step = -36; step <= 36; step += 6) {
    const sample = wallTimestamp + step * HOUR;
    const [y, mo, d, h, mi, s] = numbersAt(new Date(sample), format);
    offsets.add(Date.UTC(y, mo - 1, d, h, mi, s) - sample);
  }
  const candidates: number[] = [];
  for (const offset of offsets) {
    const instant = wallTimestamp - offset;
    const [y, mo, d, h, mi, s] = numbersAt(new Date(instant), format);
    if (y === year && mo === month && d === day && h === hour && mi === minute && s === 0) candidates.push(instant);
  }
  if (candidates.length === 0) throw new RangeError("该本地时间不存在，请避开夏令时跳转时段。");
  if (candidates.length !== 1) throw new RangeError("该本地时间有两个对应时刻，请避开夏令时回拨时段。");
  return new Date(candidates[0]).toISOString();
}

export function toClubDateTimeParts(iso: string, timeZone = getClubTimeZone()): { date: string; time: string } {
  const [year, month, day, hour, minute] = numbersAt(new Date(iso), formatter(timeZone));
  const pad = (value: number) => String(value).padStart(2, "0");
  return { date: String(year).padStart(4, "0") + "-" + pad(month) + "-" + pad(day), time: pad(hour) + ":" + pad(minute) };
}

export function formatClubDateTime(iso: string, timeZone = getClubTimeZone()): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("zh-CN", {
    timeZone, month: "numeric", day: "numeric", weekday: "short",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return parts.month + "月" + parts.day + "日 " + parts.weekday + " " + parts.hour + ":" + parts.minute;
}
