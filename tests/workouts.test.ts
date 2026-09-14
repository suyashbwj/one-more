import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.ts";
import { parseCommand } from "../server/commands.ts";
function setup() {
  const store = new Store(":memory:");
  const { id } = store.execute(randomUUID(), "start", { name: "Upper body" });
  return { store, id };
}
const input = (id: string) => ({
  sessionId: id,
  exercise: "Bench press",
  weight: 135,
  reps: 8,
  unit: "lb",
});
test("replaying the same request logs exactly one set", () => {
  const { store, id } = setup();
  const key = randomUUID();
  const first = store.execute(key, "add", input(id));
  const replay = store.execute(key, "add", input(id));
  assert.deepEqual(first, replay);
  assert.equal(store.sessions()[0].sets.length, 1);
});
test("reusing an idempotency key with different content is rejected", () => {
  const { store, id } = setup();
  const key = randomUUID();
  store.execute(key, "add", input(id));
  assert.throws(
    () => store.execute(key, "add", { ...input(id), reps: 7 }),
    /another change/,
  );
  assert.equal(store.sessions()[0].sets[0].reps, 8);
});
test("two distinct identical sets are both recorded", () => {
  const { store, id } = setup();
  store.execute(randomUUID(), "add", input(id));
  store.execute(randomUUID(), "add", input(id));
  assert.equal(store.sessions()[0].sets.length, 2);
});
test("stale edits cannot overwrite a newer correction", () => {
  const { store, id } = setup();
  const { id: setId } = store.execute(randomUUID(), "add", input(id));
  store.execute(randomUUID(), "edit", {
    ...input(id),
    setId,
    version: 1,
    reps: 7,
  });
  assert.throws(
    () =>
      store.execute(randomUUID(), "edit", {
        ...input(id),
        setId,
        version: 1,
        reps: 6,
      }),
    /another window/,
  );
  assert.equal(store.sessions()[0].sets[0].reps, 7);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM edits").get()!.n, 1);
});
test("finished sessions reject writes and only one session may be active", () => {
  const { store, id } = setup();
  assert.throws(
    () => store.execute(randomUUID(), "start", { name: "Pull day" }),
    /active workout/,
  );
  store.execute(randomUUID(), "add", input(id));
  store.execute(randomUUID(), "finish", { sessionId: id });
  assert.throws(
    () => store.execute(randomUUID(), "add", input(id)),
    /finished/,
  );
  store.execute(randomUUID(), "start", { name: "Lower body" });
  assert.equal(store.sessions().length, 2);
});
test("invalid values roll back without reserving the request key", () => {
  const { store, id } = setup();
  const key = randomUUID();
  assert.throws(() => store.execute(key, "add", { ...input(id), reps: 0 }));
  store.execute(key, "add", input(id));
  assert.equal(store.sessions()[0].sets.length, 1);
});
test("zero weight bodyweight sets are supported; fractional reps are rejected", () => {
  const { store, id } = setup();
  store.execute(randomUUID(), "add", {
    ...input(id),
    exercise: "Pull-up",
    weight: 0,
  });
  assert.throws(() =>
    store.execute(randomUUID(), "add", { ...input(id), reps: 7.5 }),
  );
  assert.equal(store.sessions()[0].sets[0].weight, 0);
});
test("sessions and replay results survive a process restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "one-more-test-"));
  try {
    const path = join(dir, "test.sqlite");
    const store = new Store(path);
    const { id } = store.execute(randomUUID(), "start", { name: "Upper body" });
    const key = randomUUID();
    store.execute(key, "add", input(id));
    store.db.close();
    const reopened = new Store(path);
    reopened.execute(key, "add", input(id));
    assert.equal(reopened.sessions()[0].sets.length, 1);
    assert.equal(reopened.sessions()[0].endedAt, null);
    reopened.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("ambiguous corrections ask for a set instead of changing data", () => {
  const { store, id } = setup();
  store.execute(randomUUID(), "add", input(id));
  const r = parseCommand(
    "Actually 7 reps",
    store.sessions()[0],
    "Bench press",
    "lb",
  );
  assert.equal(r.action, undefined);
  assert.match(r.message, /Which set/);
  assert.equal(store.sessions()[0].sets[0].reps, 8);
});
test("explicit correction targets the chosen exercise and preserves its units", () => {
  const { store, id } = setup();
  for (let i = 0; i < 2; i++)
    store.execute(randomUUID(), "add", {
      ...input(id),
      unit: "kg",
      weight: 60,
    });
  const r = parseCommand(
    "Change set 2 to 7 reps",
    store.sessions()[0],
    "Bench press",
    "lb",
  );
  assert.equal(r.action, "edit");
  assert.equal(r.payload?.reps, 7);
  assert.equal(r.payload?.unit, "kg");
  assert.equal(r.payload?.setId, store.sessions()[0].sets[1].id);
});
test("specific exercise names win over overlapping aliases", () => {
  const { store } = setup();
  const r = parseCommand(
    "Romanian deadlift 60 kg for 8 reps",
    store.sessions()[0],
    "Bench press",
    "lb",
  );
  assert.equal(r.payload?.exercise, "Romanian deadlift");
  assert.equal(r.payload?.unit, "kg");
  assert.equal(r.payload?.weight, 60);
});
test("unsupported commands and missing values do not write", () => {
  const { store } = setup();
  for (const text of [
    "delete last set",
    "135 pounds",
    "finish workout",
    "change set 9 to 8 reps",
  ])
    assert.equal(
      parseCommand(text, store.sessions()[0], "Bench press", "lb").action,
      undefined,
    );
  assert.equal(store.sessions()[0].sets.length, 0);
});
test("negative numbers, fractional reps and conflicting units require clarification", () => {
  const { store } = setup();
  for (const text of [
    "-5 lb for 8 reps",
    "135 lb for 8.5 reps",
    "135 lb 60 kg for 8 reps",
    "don't log 135 lb for 8 reps",
  ])
    assert.equal(
      parseCommand(text, store.sessions()[0], "Bench press", "lb").action,
      undefined,
    );
});

test("discard permits a fresh start but never discards logged sets", () => {
  const { store, id } = setup();
  store.execute(randomUUID(), "discard", { sessionId: id });
  assert.equal(store.sessions().length, 0);
  const { id: next } = store.execute(randomUUID(), "start", {
    name: "Pull day",
  });
  store.execute(randomUUID(), "add", input(next));
  assert.throws(
    () => store.execute(randomUUID(), "discard", { sessionId: next }),
    /Only an empty workout/,
  );
  assert.equal(store.sessions()[0].sets.length, 1);
});

test("notes are durable, replay-safe, and reject stale overwrites even after finishing", () => {
  const { store, id } = setup();
  const key = randomUUID();
  const payload = { sessionId: id, notes: "Narrower bench setup", version: 1 };
  store.execute(key, "notes", payload);
  store.execute(key, "notes", payload);
  assert.equal(store.sessions()[0].notesVersion, 2);
  assert.throws(
    () => store.execute(randomUUID(), "notes", { ...payload, notes: "stale" }),
    /another window/,
  );
  store.execute(randomUUID(), "add", input(id));
  store.execute(randomUUID(), "finish", { sessionId: id });
  store.execute(randomUUID(), "notes", {
    sessionId: id,
    notes: "Finished strong",
    version: 2,
  });
  assert.equal(store.sessions()[0].notes, "Finished strong");
  assert.throws(() =>
    store.execute(randomUUID(), "notes", {
      sessionId: id,
      notes: "x".repeat(2001),
      version: 3,
    }),
  );
  assert.equal(store.sessions()[0].notesVersion, 3);
  store.db.close();
});

test("legacy database migration preserves workouts and initializes notes", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const dir = mkdtempSync(join(tmpdir(), "one-more-migrate-"));
  const path = join(dir, "legacy.sqlite");
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE sessions(id TEXT PRIMARY KEY,name TEXT NOT NULL,started_at TEXT NOT NULL,ended_at TEXT,demo INTEGER NOT NULL DEFAULT 0)",
  );
  db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?)").run(
    "legacy",
    "Upper body",
    "2026-09-01T12:00:00Z",
    null,
    0,
  );
  db.close();
  const store = new Store(path);
  assert.equal(store.sessions()[0].name, "Upper body");
  assert.equal(store.sessions()[0].notes, "");
  store.execute(randomUUID(), "notes", {
    sessionId: "legacy",
    notes: "Survives restart",
    version: 1,
  });
  store.db.close();
  const reopened = new Store(path);
  assert.equal(reopened.sessions()[0].notes, "Survives restart");
  reopened.db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("sample seeding works after notes migration", () => {
  const store = new Store(":memory:");
  store.seedDemo();
  assert.equal(store.sessions().length, 5);
  assert.ok(
    store
      .sessions()
      .every((s) => s.demo && s.notes === "" && s.notesVersion === 1),
  );
  store.db.close();
});
