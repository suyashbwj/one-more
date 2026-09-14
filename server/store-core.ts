import { randomUUID } from "node:crypto";
import { z } from "zod";
export const EXERCISES = [
  "Bench press",
  "Incline dumbbell press",
  "Cable fly",
  "Shoulder press",
  "Lateral raise",
  "Triceps pushdown",
  "Squat",
  "Romanian deadlift",
  "Leg press",
  "Leg curl",
  "Calf raise",
  "Deadlift",
  "Lat pulldown",
  "Barbell row",
  "Seated cable row",
  "Biceps curl",
  "Pull-up",
];
export type SetRecord = {
  id: string;
  exercise: string;
  weight: number;
  reps: number;
  unit: "lb" | "kg";
  version: number;
  createdAt: string;
};
export type Session = {
  id: string;
  name: string;
  startedAt: string;
  endedAt: string | null;
  sets: SetRecord[];
  demo: boolean;
  notes: string;
  notesVersion: number;
};
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const setInput = z.object({
  exercise: z.enum(EXERCISES as [string, ...string[]]),
  weight: z.number().finite().min(0).max(2000),
  reps: z.number().int().min(1).max(200),
  unit: z.enum(["lb", "kg"]),
});
export interface DatabaseAdapter {
  exec(sql: string): unknown;
  prepare(sql: string): {
    all(...values: any[]): any[];
    get(...values: any[]): any;
    run(...values: any[]): unknown;
  };
  transaction<T>(work: () => T): T;
  close(): void;
}
export class StoreCore {
  constructor(public db: DatabaseAdapter) {
    this.db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,name TEXT NOT NULL,started_at TEXT NOT NULL,ended_at TEXT,demo INTEGER NOT NULL DEFAULT 0);
 CREATE UNIQUE INDEX IF NOT EXISTS one_active ON sessions((1)) WHERE ended_at IS NULL;
 CREATE TABLE IF NOT EXISTS sets(id TEXT PRIMARY KEY,session_id TEXT REFERENCES sessions(id),exercise TEXT NOT NULL,weight REAL NOT NULL,reps INTEGER NOT NULL,unit TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,payload TEXT NOT NULL,result TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS edits(id TEXT PRIMARY KEY,set_id TEXT NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,created_at TEXT NOT NULL);`);
    const columns = this.db.prepare("PRAGMA table_info(sessions)").all() as {
      name: string;
    }[];
    if (!columns.some((c) => c.name === "notes"))
      this.db.exec(
        "ALTER TABLE sessions ADD COLUMN notes TEXT NOT NULL DEFAULT ''",
      );
    if (!columns.some((c) => c.name === "notes_version"))
      this.db.exec(
        "ALTER TABLE sessions ADD COLUMN notes_version INTEGER NOT NULL DEFAULT 1",
      );
  }
  sessions(): Session[] {
    return (
      this.db
        .prepare("SELECT * FROM sessions ORDER BY started_at DESC")
        .all() as any[]
    ).map((s) => ({
      id: s.id,
      name: s.name,
      startedAt: s.started_at,
      endedAt: s.ended_at,
      demo: !!s.demo,
      notes: s.notes,
      notesVersion: s.notes_version,
      sets: (
        this.db
          .prepare(
            "SELECT * FROM sets WHERE session_id=? ORDER BY created_at,rowid",
          )
          .all(s.id) as any[]
      ).map((x) => ({
        id: x.id,
        exercise: x.exercise,
        weight: x.weight,
        reps: x.reps,
        unit: x.unit,
        version: x.version,
        createdAt: x.created_at,
      })),
    }));
  }
  execute(requestId: string, action: string, payload: any): any {
    z.string().uuid().parse(requestId);
    const fingerprint = JSON.stringify({ action, payload });
    return this.db.transaction(() => {
      const prior = this.db
        .prepare("SELECT * FROM requests WHERE id=?")
        .get(requestId) as any;
      if (prior) {
        if (prior.payload !== fingerprint)
          throw new AppError(
            409,
            "That request ID was already used for another change.",
          );
        return JSON.parse(prior.result);
      }
      const result = this.mutate(action, payload);
      this.db
        .prepare("INSERT INTO requests VALUES(?,?,?)")
        .run(requestId, fingerprint, JSON.stringify(result));
      return result;
    });
  }
  mutate(action: string, p: any) {
    if (action === "start") {
      const name = z.string().trim().min(1).max(60).parse(p.name);
      if (this.sessions().some((s) => !s.endedAt))
        throw new AppError(
          409,
          "You already have an active workout. Resume or finish it first.",
        );
      const id = randomUUID();
      this.db
        .prepare("INSERT INTO sessions(id,name,started_at) VALUES(?,?,?)")
        .run(id, name, new Date().toISOString());
      return { id, message: "Workout started. Let’s make it count." };
    }
    const session = this.sessions().find((s) => s.id === p.sessionId);
    if (!session) throw new AppError(404, "Workout not found.");
    if (action === "notes") {
      const notes = z.string().max(2000).parse(p.notes);
      const version = z.number().int().positive().parse(p.version);
      if (version !== session.notesVersion)
        throw new AppError(
          409,
          "These notes changed in another window. Review the saved version before replacing it.",
        );
      this.db
        .prepare(
          "UPDATE sessions SET notes=?,notes_version=notes_version+1 WHERE id=?",
        )
        .run(notes, session.id);
      return { message: "Session notes saved." };
    }
    if (session.endedAt)
      throw new AppError(
        409,
        "This workout is finished. Start a new session to log sets.",
      );
    if (action === "discard") {
      if (session.sets.length)
        throw new AppError(
          409,
          "Only an empty workout can be discarded. Finish this session to preserve your sets.",
        );
      this.db.prepare("DELETE FROM sessions WHERE id=?").run(session.id);
      return { message: "Empty workout discarded. Ready for a fresh start." };
    }
    if (action === "finish") {
      if (!session.sets.length)
        throw new AppError(400, "Log at least one set before finishing.");
      this.db
        .prepare("UPDATE sessions SET ended_at=? WHERE id=?")
        .run(new Date().toISOString(), session.id);
      return { message: "Workout saved. One more in the books." };
    }
    if (action === "add") {
      const x = setInput.parse(p);
      const id = randomUUID();
      this.db
        .prepare("INSERT INTO sets VALUES(?,?,?,?,?,?,1,?)")
        .run(
          id,
          session.id,
          x.exercise,
          x.weight,
          x.reps,
          x.unit,
          new Date().toISOString(),
        );
      return {
        id,
        message: `${x.exercise}: ${x.weight} ${x.unit} × ${x.reps}. Logged.`,
      };
    }
    const old = session.sets.find((s) => s.id === p.setId);
    if (!old)
      throw new AppError(
        404,
        "That set no longer exists. Refresh your workout.",
      );
    if (old.version !== p.version)
      throw new AppError(
        409,
        "This set changed in another window. Review the latest values and try again.",
      );
    if (action === "edit") {
      const x = setInput.parse({ ...old, ...p });
      const next = { ...old, ...x, version: old.version + 1 };
      this.db
        .prepare(
          "UPDATE sets SET exercise=?,weight=?,reps=?,unit=?,version=? WHERE id=?",
        )
        .run(x.exercise, x.weight, x.reps, x.unit, next.version, old.id);
      this.db
        .prepare("INSERT INTO edits VALUES(?,?,?,?,?)")
        .run(
          randomUUID(),
          old.id,
          JSON.stringify(old),
          JSON.stringify(next),
          new Date().toISOString(),
        );
      return { message: "Set corrected. Edit history preserved." };
    }
    if (action === "delete") {
      this.db.prepare("DELETE FROM sets WHERE id=?").run(old.id);
      this.db
        .prepare("INSERT INTO edits VALUES(?,?,?,?,?)")
        .run(
          randomUUID(),
          old.id,
          JSON.stringify(old),
          "null",
          new Date().toISOString(),
        );
      return { message: "Set removed." };
    }
    throw new AppError(400, "Unknown operation.");
  }
  seedDemo() {
    if (this.sessions().length)
      throw new AppError(
        409,
        "Sample history is only available in an empty journal.",
      );
    return this.db.transaction(() => {
      for (let d = 1; d <= 9; d += 2) {
        const id = randomUUID();
        const start = new Date(Date.now() - d * 86400000);
        this.db
          .prepare(
            "INSERT INTO sessions(id,name,started_at,ended_at,demo) VALUES(?,?,?,?,1)",
          )
          .run(
            id,
            d % 3 === 0 ? "Lower body" : "Upper body",
            start.toISOString(),
            new Date(+start + 45 * 60000).toISOString(),
          );
        for (const ex of d % 3 === 0
          ? ["Squat", "Romanian deadlift", "Leg curl"]
          : ["Bench press", "Barbell row", "Shoulder press"])
          for (let i = 0; i < 3; i++)
            this.db
              .prepare("INSERT INTO sets VALUES(?,?,?,?,?,?,1,?)")
              .run(
                randomUUID(),
                id,
                ex,
                ex === "Bench press" ? 135 : 95,
                8 + i,
                "lb",
                new Date(+start + i * 60000).toISOString(),
              );
      }
    });
  }
}
