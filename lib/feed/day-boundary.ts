const MARKET_TIME_ZONE = "America/New_York";
const ROLLOVER_HOUR = 4;

type EasternParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
};

function getEasternParts(date: Date): EasternParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: MARKET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });

  const parts = formatter.formatToParts(date);
  const getValue = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";

  return {
    year: Number(getValue("year")),
    month: Number(getValue("month")),
    day: Number(getValue("day")),
    hour: Number(getValue("hour")),
    minute: Number(getValue("minute")),
    weekday: getValue("weekday"),
  };
}

function addDaysToDateKey(dateKey: string, deltaDays: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return `${utcDate.getUTCFullYear()}-${String(utcDate.getUTCMonth() + 1).padStart(2, "0")}-${String(utcDate.getUTCDate()).padStart(2, "0")}`;
}

export function getMarketDayKey(date = new Date()) {
  const parts = getEasternParts(date);
  const sessionDate = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  return parts.hour < ROLLOVER_HOUR ? addDaysToDateKey(sessionDate, -1) : sessionDate;
}

export function getMarketPhaseForTime(date: Date) {
  const parts = getEasternParts(date);
  const minutes = parts.hour * 60 + parts.minute;

  if (minutes >= 240 && minutes < 570) {
    return "premarket" as const;
  }

  if (minutes >= 570 && minutes < 960) {
    return "regular" as const;
  }

  if (minutes >= 960 && minutes < 1200) {
    return "after-hours" as const;
  }

  return "closed" as const;
}

export function formatMarketTimestamp(timestamp: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: MARKET_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

export function formatMarketDateLabel(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: MARKET_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day, 12, 0, 0)));
}

export function isSameMarketMinute(leftTimestamp: string, rightTimestamp: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: MARKET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  return formatter.format(new Date(leftTimestamp)) === formatter.format(new Date(rightTimestamp));
}

export function getMarketTimeZone() {
  return MARKET_TIME_ZONE;
}
