import type { ProfileConfig } from "@morning-signal/contracts";

export interface EditionWindow {
  currentStart: Date;
  end: Date;
  catchupStart: Date;
}

function zonedLocalTime(date: string, time: string, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || !timeMatch) {
    throw new Error(`Invalid local date/time: ${date} ${time}`);
  }

  const desired = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
  );
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  let candidate = desired;

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(candidate))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
    const observed = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    candidate += desired - observed;
  }

  return new Date(candidate);
}

export function editionWindow(
  editionDate: string,
  profile: ProfileConfig,
): EditionWindow {
  const end = zonedLocalTime(
    editionDate,
    profile.edition.publish_time,
    profile.timezone,
  );
  return {
    end,
    currentStart: new Date(
      end.getTime() - profile.edition.coverage_hours * 3_600_000,
    ),
    catchupStart: new Date(
      end.getTime() - profile.edition.catchup_days * 86_400_000,
    ),
  };
}
