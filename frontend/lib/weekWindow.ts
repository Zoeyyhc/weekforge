import { Weekday } from "@/lib/buildRequest";

const WEEKDAY_INDEX: Record<Weekday, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

function localMidnight(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date: Date, days: number): Date {
  const copy = localMidnight(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function compareDates(a: Date, b: Date): number {
  return a.getTime() - b.getTime();
}

export function toISODate(date: Date): string {
  const midnight = localMidnight(date);
  const year = midnight.getFullYear();
  const month = String(midnight.getMonth() + 1).padStart(2, "0");
  const day = String(midnight.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function fromISODate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function toLocalMidnightISO(isoDate: string): string {
  const midnight = localMidnight(fromISODate(isoDate));
  const year = midnight.getFullYear();
  const month = String(midnight.getMonth() + 1).padStart(2, "0");
  const day = String(midnight.getDate()).padStart(2, "0");
  const hours = String(midnight.getHours()).padStart(2, "0");
  const minutes = String(midnight.getMinutes()).padStart(2, "0");
  const seconds = String(midnight.getSeconds()).padStart(2, "0");
  const offsetMinutes = -midnight.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absoluteOffset / 60)).padStart(2, "0");
  const offsetRemainder = String(absoluteOffset % 60).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetRemainder}`;
}

export function weekMonday(date: Date): Date {
  const midnight = localMidnight(date);
  const offset = (midnight.getDay() + 6) % 7;
  return addDays(midnight, -offset);
}

export function weekSunday(date: Date): Date {
  return addDays(weekMonday(date), 6);
}

export function earliestSchedulableDate(now: Date, workdayEndHour: number): Date {
  const midnight = localMidnight(now);
  if (now.getHours() < workdayEndHour) {
    return midnight;
  }
  return addDays(midnight, 1);
}

export function isWeekSelectable(weekMondayDate: Date, now: Date, workdayEndHour: number): boolean {
  return compareDates(weekSunday(weekMondayDate), earliestSchedulableDate(now, workdayEndHour)) >= 0;
}

export function defaultWeekMonday(now: Date, workdayEndHour: number): Date {
  const currentWeekMonday = weekMonday(now);
  return isWeekSelectable(currentWeekMonday, now, workdayEndHour)
    ? currentWeekMonday
    : addDays(currentWeekMonday, 7);
}

export function isPastDay(day: Weekday, weekMondayDate: Date, now: Date, workdayEndHour: number): boolean {
  const earliest = earliestSchedulableDate(now, workdayEndHour);
  const dayDate = addDays(weekMondayDate, WEEKDAY_INDEX[day]);
  return compareDates(dayDate, earliest) < 0;
}

export function monthWeeks(date: Date): Date[] {
  const monthStart = localMidnight(new Date(date.getFullYear(), date.getMonth(), 1));
  const monthEnd = localMidnight(new Date(date.getFullYear(), date.getMonth() + 1, 0));
  const weeks: Date[] = [];
  for (let current = weekMonday(monthStart); compareDates(current, monthEnd) <= 0; current = addDays(current, 7)) {
    weeks.push(current);
  }
  return weeks;
}
