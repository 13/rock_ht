"use client";

import { format, parseISO } from "date-fns";
import { useProfile } from "./use-profile";
import type { DateFormat, TimeFormat } from "@sisigo/types";

const DATE_FNS_FORMAT: Record<DateFormat, string> = {
  "DD.MM.YYYY": "dd.MM.yyyy",
  "MM/DD/YYYY": "MM/dd/yyyy",
  "YYYY-MM-DD": "yyyy-MM-dd",
  "D MMM YYYY": "d MMM yyyy",
};

const TIME_FNS_FORMAT: Record<TimeFormat, string> = {
  "12h": "h:mm a",
  "24h": "HH:mm",
};

export function useLocale() {
  const { profile } = useProfile();

  const dateFormat: DateFormat = profile?.date_format ?? "MM/DD/YYYY";
  const timeFormat: TimeFormat = profile?.time_format ?? "12h";

  function formatLocalDate(dateStr: string): string {
    return format(parseISO(dateStr), DATE_FNS_FORMAT[dateFormat]);
  }

  function formatLocalTime(timeStr: string): string {
    // timeStr is HH:mm (stored in DB as TIME without seconds)
    const parts = timeStr.split(":");
    const d = new Date();
    d.setHours(Number(parts[0] ?? 0), Number(parts[1] ?? 0), 0, 0);
    return format(d, TIME_FNS_FORMAT[timeFormat]);
  }

  function formatLocalDateTime(date: Date | string): string {
    const d = typeof date === "string" ? parseISO(date) : date;
    return format(d, `${DATE_FNS_FORMAT[dateFormat]} ${TIME_FNS_FORMAT[timeFormat]}`);
  }

  return {
    dateFormat,
    timeFormat,
    formatLocalDate,
    formatLocalTime,
    formatLocalDateTime,
    datePlaceholder: dateFormat,
  };
}
