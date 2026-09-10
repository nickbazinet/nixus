import { describe, expect, it } from "vitest";
import {
  formatServiceEntryFullDate,
  formatServiceEntryShortDate,
} from "@/lib/serviceHistoryDates";

const EN_MONTH_ABBREVIATIONS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const EVERY_MONTH = EN_MONTH_ABBREVIATIONS.map(
  (_, index) => `2026-${String(index + 1).padStart(2, "0")}-09`
);

describe("service history date localization", () => {
  it("renders the row date without a year in English", () => {
    expect(formatServiceEntryShortDate("2026-09-09", "en")).toBe("Sep 9");
    expect(formatServiceEntryShortDate("2026-09-09", "en")).not.toContain("2026");
  });

  it("renders no English month abbreviation in French for any month", () => {
    for (const isoDate of EVERY_MONTH) {
      const short = formatServiceEntryShortDate(isoDate, "fr");
      const full = formatServiceEntryFullDate(isoDate, "fr");
      for (const english of EN_MONTH_ABBREVIATIONS) {
        expect(short, `${isoDate} short leaked ${english}`).not.toContain(english);
        expect(full, `${isoDate} full leaked ${english}`).not.toContain(english);
      }
    }
  });

  it("renders the French month name for the row date", () => {
    expect(formatServiceEntryShortDate("2026-09-09", "fr")).toContain("sept");
    expect(formatServiceEntryShortDate("2026-01-05", "fr")).toContain("janv");
  });

  it("adds the year only to the prose date, in the locale's own order", () => {
    expect(formatServiceEntryFullDate("2026-09-09", "en")).toBe("Sep 9, 2026");
    expect(formatServiceEntryFullDate("2026-09-09", "fr")).toContain("2026");
    expect(formatServiceEntryShortDate("2026-09-09", "fr")).not.toContain("2026");
  });

  // A bare `new Date("2026-03-01")` is UTC midnight, which is Feb 28 in every North American zone —
  // the exact off-by-one this module's part-splitting exists to prevent.
  it("keeps the calendar day the user typed, not the UTC one", () => {
    expect(formatServiceEntryShortDate("2026-03-01", "en")).toBe("Mar 1");
    expect(formatServiceEntryFullDate("2026-01-01", "en")).toBe("Jan 1, 2026");
  });
});
