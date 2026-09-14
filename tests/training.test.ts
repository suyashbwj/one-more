import { test } from "node:test";
import assert from "node:assert/strict";
import { exerciseHistory, filterHistory } from "../src/training.ts";
import type { Session, SetRecord } from "../server/store.ts";
const set = (weight: number, unit: "lb" | "kg", reps: number): SetRecord => ({
  id: "set",
  exercise: "Bench press",
  weight,
  unit,
  reps,
  version: 1,
  createdAt: "2026-09-01",
});
const session = (
  id: string,
  sets: SetRecord[],
  extra: Partial<Session> = {},
): Session => ({
  id,
  name: "Upper body",
  startedAt: `2026-09-0${id}T12:00:00Z`,
  endedAt: `2026-09-0${id}T13:00:00Z`,
  demo: false,
  notes: "Narrow grip",
  notesVersion: 1,
  sets,
  ...extra,
});
test("trends sort dates, exclude active and sample workouts, and normalize mixed units", () => {
  const a = session("1", [set(100, "lb", 8)]),
    b = session("2", [set(50, "kg", 10), set(0, "lb", 12)]);
  const rows = exerciseHistory(
    [
      b,
      session("3", [set(999, "lb", 8)], { demo: true }),
      a,
      session("4", [set(200, "lb", 8)], { endedAt: null }),
    ],
    "Bench press",
  );
  assert.deepEqual(
    rows.map((x) => x.session.id),
    ["1", "2"],
  );
  assert.ok(Math.abs(rows[1].topWeight - 110.231) < 0.001);
  assert.ok(Math.abs(rows[1].volume - 1102.31) < 0.001);
  assert.equal(rows[1].reps, 22);
  assert.equal(exerciseHistory([a, b], "Squat").length, 0);
  assert.equal(
    exerciseHistory(
      [session("3", [set(1, "lb", 1)], { demo: true })],
      "Bench press",
      true,
    ).length,
    1,
  );
});
test("history search matches notes, exercises, and names with explicit sample filters", () => {
  const real = session("1", [set(0, "lb", 12)]),
    sample = session("2", [set(135, "lb", 8)], { demo: true });
  assert.equal(filterHistory([real, sample], " NARROW ", "real").length, 1);
  assert.equal(filterHistory([real, sample], "bench", "sample").length, 1);
  assert.equal(filterHistory([real, sample], "upper", "all").length, 2);
  assert.equal(filterHistory([real, sample], "squat", "all").length, 0);
});
