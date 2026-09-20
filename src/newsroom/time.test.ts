import { describe, expect, it } from "vitest";
import { addDays, localDate, localHour, weekdayOf, weekendWindow } from "./time.js";

describe("local time", () => {
  it("reads the calendar day and hour in America/Los_Angeles", () => {
    expect(localDate(new Date("2026-09-27T05:30:00Z"))).toBe("2026-09-26");
    expect(localHour(new Date("2026-09-27T05:30:00Z"))).toBe(22);
    expect(localHour(new Date("2026-09-26T22:00:00Z"))).toBe(15);
  });

  it("numbers weekdays the way RHYTHM does", () => {
    expect(weekdayOf("2026-09-21")).toBe(1); // Monday
    expect(weekdayOf("2026-09-27")).toBe(0); // Sunday
    expect(addDays("2026-09-30", 2)).toBe("2026-10-02");
  });
});

describe("weekendWindow", () => {
  it("holds the same weekend across the fall-back", () => {
    // Daylight saving ends on Sunday 2026-11-01, so this weekend opens on PDT
    // (UTC-7) and closes on PST (UTC-8). Every run inside it, and the Monday
    // looking ahead to it, must name the same two instants.
    const from = new Date("2026-10-30T07:00:00.000Z"); // Fri 00:00:00.000 PDT
    const to = new Date("2026-11-02T07:59:59.999Z"); //   Sun 23:59:59.999 PST

    const runs = [
      "2026-10-26T17:00:00Z", // Monday morning, looking ahead
      "2026-10-30T18:00:00Z", // Friday, the weekend has opened
      "2026-10-31T20:00:00Z", // Saturday, still on PDT
      "2026-11-01T20:00:00Z", // Sunday, now on PST
    ];
    for (const run of runs) {
      expect(weekendWindow(new Date(run))).toEqual({ from, to });
    }
  });
});
