export type MarketSessionStatus = "premarket" | "regular" | "after-hours" | "closed";

type MarketClock = {
  sessionStatus: MarketSessionStatus;
  sessionDate: string;
  isTradingDay: boolean;
  label: string;
};

function getEasternParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
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
    second: Number(getValue("second")),
    weekday: getValue("weekday"),
  };
}

export function getMarketClock(date = new Date()): MarketClock {
  const parts = getEasternParts(date);
  const sessionDate = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  const isTradingDay = parts.weekday !== "Sat" && parts.weekday !== "Sun";
  const minutes = parts.hour * 60 + parts.minute;

  if (!isTradingDay) {
    return {
      sessionStatus: "closed",
      sessionDate,
      isTradingDay,
      label: "Closed",
    };
  }

  if (minutes >= 240 && minutes < 570) {
    return {
      sessionStatus: "premarket",
      sessionDate,
      isTradingDay,
      label: "Premarket",
    };
  }

  if (minutes >= 570 && minutes < 960) {
    return {
      sessionStatus: "regular",
      sessionDate,
      isTradingDay,
      label: "Regular",
    };
  }

  if (minutes >= 960 && minutes < 1200) {
    return {
      sessionStatus: "after-hours",
      sessionDate,
      isTradingDay,
      label: "After-Hours",
    };
  }

  return {
    sessionStatus: "closed",
    sessionDate,
    isTradingDay,
    label: "Closed",
  };
}
