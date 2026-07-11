import {
  format,
  parseISO,
  isToday,
  isYesterday,
  differenceInDays,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  subDays,
  addDays,
  getDay,
  startOfDay,
  isSameDay,
} from "date-fns";

export const DATE_FORMAT = "yyyy-MM-dd";

export function today(): string {
  return format(new Date(), DATE_FORMAT);
}

export function yesterday(): string {
  return format(subDays(new Date(), 1), DATE_FORMAT);
}

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  return format(d, DATE_FORMAT);
}

export function parseDate(dateStr: string): Date {
  return parseISO(dateStr);
}

export function isTodayDate(dateStr: string): boolean {
  return isToday(parseISO(dateStr));
}

export function isYesterdayDate(dateStr: string): boolean {
  return isYesterday(parseISO(dateStr));
}

export function daysBetween(a: string, b: string): number {
  return Math.abs(differenceInDays(parseISO(a), parseISO(b)));
}

export function subtractDays(dateStr: string, days: number): string {
  return formatDate(subDays(parseISO(dateStr), days));
}

export function addDaysToDate(dateStr: string, days: number): string {
  return formatDate(addDays(parseISO(dateStr), days));
}

export function getDayOfWeek(dateStr: string): number {
  return getDay(parseISO(dateStr)); // 0=Sun, 6=Sat
}

export function getLast30Days(): string[] {
  const end = new Date();
  const start = subDays(end, 29);
  return eachDayOfInterval({ start, end }).map(formatDate);
}

export function getLast7Days(): string[] {
  const end = new Date();
  const start = subDays(end, 6);
  return eachDayOfInterval({ start, end }).map(formatDate);
}

export function getCurrentWeekDays(): string[] {
  const now = new Date();
  const start = startOfWeek(now, { weekStartsOn: 1 }); // Monday
  const end = endOfWeek(now, { weekStartsOn: 1 });
  return eachDayOfInterval({ start, end }).map(formatDate);
}

export function formatRelativeDay(dateStr: string): string {
  const date = parseISO(dateStr);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "MMM d");
}

export function formatDisplayDate(dateStr: string): string {
  return format(parseISO(dateStr), "MMMM d, yyyy");
}

export function formatShortDay(dateStr: string): string {
  return format(parseISO(dateStr), "EEE");
}

export function formatDayNumber(dateStr: string): string {
  return format(parseISO(dateStr), "d");
}

export function isSameDayDate(a: string, b: string): boolean {
  return isSameDay(parseISO(a), parseISO(b));
}

export function startOfCurrentDay(): Date {
  return startOfDay(new Date());
}
