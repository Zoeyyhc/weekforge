import { describe, it, expect } from "vitest";
import {
  weekMonday, weekSunday, earliestSchedulableDate, isWeekSelectable,
  defaultWeekMonday, isPastDay, toISODate, fromISODate, monthWeeks,
} from "@/lib/weekWindow";

const at = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h);

describe("weekWindow", () => {
  it("weekMonday returns the Monday of the week", () => {
    expect(toISODate(weekMonday(at(2026, 6, 17)))).toBe("2026-06-15");
    expect(toISODate(weekMonday(at(2026, 6, 15)))).toBe("2026-06-15");
  });

  it("earliest is today when before work-day end, tomorrow when after", () => {
    expect(toISODate(earliestSchedulableDate(at(2026, 6, 17, 10), 18))).toBe("2026-06-17");
    expect(toISODate(earliestSchedulableDate(at(2026, 6, 17, 20), 18))).toBe("2026-06-18");
  });

  it("current week selectable on a weekday; past week not", () => {
    const now = at(2026, 6, 17, 10);
    expect(isWeekSelectable(weekMonday(now), now, 18)).toBe(true);
    expect(isWeekSelectable(weekMonday(at(2026, 6, 10)), now, 18)).toBe(false);
  });

  it("current week NOT selectable when it's Sunday past work hours", () => {
    const now = at(2026, 6, 21, 20);
    expect(isWeekSelectable(weekMonday(now), now, 18)).toBe(false);
    expect(toISODate(defaultWeekMonday(now, 18))).toBe("2026-06-22");
  });

  it("isPastDay flags days before today in the current week, none in a future week", () => {
    const now = at(2026, 6, 17, 10);
    const thisMon = weekMonday(now);
    expect(isPastDay("Mon", thisMon, now, 18)).toBe(true);
    expect(isPastDay("Wed", thisMon, now, 18)).toBe(false);
    const nextMon = fromISODate("2026-06-22");
    expect(isPastDay("Mon", nextMon, now, 18)).toBe(false);
  });

  it("monthWeeks returns each week-row Monday covering the month", () => {
    const weeks = monthWeeks(at(2026, 6, 1)).map(toISODate);
    expect(weeks[0]).toBe("2026-06-01");
    expect(weeks).toContain("2026-06-29");
  });
});
