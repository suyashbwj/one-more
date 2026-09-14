import React, { useState, useEffect } from "react";
import { ArrowUpRight, Check, RotateCcw } from "lucide-react";
import type { Session, SetRecord } from "../../server/store";
import { exerciseHistory } from "../training";
const number = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 1 });
const date = (s: string) =>
  new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function PreviousSession({
  sessions,
  exercise,
  index,
  onUse,
  editing,
}: {
  sessions: Session[];
  exercise: string;
  index: number;
  onUse: (set: SetRecord) => void;
  editing: boolean;
}) {
  const previous = exerciseHistory(sessions, exercise).at(-1);
  if (!previous)
    return (
      <div className="previous-session quiet">
        Your first benchmark. Log a session to compare next time.
      </div>
    );
  const target = previous.sets[index] || previous.sets.at(-1)!;
  return (
    <section
      className="previous-session"
      aria-label="Previous session reference"
    >
      <div className="section-heading">
        <span className="eyebrow">
          LAST TIME / {date(previous.session.startedAt)}
        </span>
        <span>
          {previous.sets.length} {previous.sets.length === 1 ? "set" : "sets"}
        </span>
      </div>
      <div className="previous-sets">
        {previous.sets.map((s, i) => (
          <span key={s.id}>
            <small>{String(i + 1).padStart(2, "0")}</small> {s.weight} {s.unit}{" "}
            × {s.reps}
          </span>
        ))}
      </div>
      <button
        type="button"
        className="text-button"
        disabled={editing}
        onClick={() => onUse(target)}
      >
        <RotateCcw size={14} /> Use {target.weight} {target.unit} ×{" "}
        {target.reps} for next set
      </button>
      <p>Fills the form. Log when you finish the set.</p>
    </section>
  );
}

export function SessionNotes({
  session,
  onSave,
  busy,
}: {
  session: Session;
  onSave: (action: string, payload: any) => Promise<boolean>;
  busy: boolean;
}) {
  const storageKey = "one-more:notes-draft:" + session.id;
  const [initial] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (
        typeof saved?.draft === "string" &&
        typeof saved?.base?.text === "string" &&
        Number.isInteger(saved?.base?.version)
      )
        return saved as {
          draft: string;
          base: { text: string; version: number };
        };
    } catch {}
    return {
      draft: session.notes || "",
      base: { text: session.notes || "", version: session.notesVersion },
    };
  });
  const [draft, setDraft] = useState(initial.draft);
  const [base, setBase] = useState(initial.base);
  const dirty = draft !== base.text;
  const conflict = session.notesVersion !== base.version;
  const savedText = session.notes || "";
  useEffect(() => {
    try {
      if (dirty)
        localStorage.setItem(storageKey, JSON.stringify({ draft, base }));
      else localStorage.removeItem(storageKey);
    } catch {}
  }, [storageKey, draft, base, dirty]);
  return (
    <section className="session-notes" aria-label="Session notes">
      <div className="section-heading">
        <div>
          <span className="eyebrow">THE CONTEXT BEHIND THE NUMBERS</span>
          <h3>Session notes</h3>
        </div>
        <span className="notes-state">
          {dirty ? (
            "Unsaved changes"
          ) : (
            <>
              <Check size={13} /> Saved
            </>
          )}
        </span>
      </div>
      <label htmlFor={"notes-" + session.id}>
        Equipment, energy, or something to remember next time.
      </label>
      <textarea
        id={"notes-" + session.id}
        value={draft}
        maxLength={2000}
        rows={3}
        placeholder="Different bench today. Keep the setup a little narrower…"
        onChange={(e) => setDraft(e.target.value)}
      />
      {conflict && (
        <div className="notes-conflict" role="status">
          <p>
            The saved notes changed in another window. Your draft is still here.
          </p>
          <blockquote>{savedText || "(Saved notes are empty)"}</blockquote>
          <button
            className="text-button"
            onClick={() => {
              setDraft(savedText);
              setBase({ text: savedText, version: session.notesVersion });
            }}
          >
            Load saved notes
          </button>
          <button
            className="text-button"
            onClick={() =>
              setBase({ text: savedText, version: session.notesVersion })
            }
          >
            Keep my draft for the next save
          </button>
        </div>
      )}
      <div className="notes-actions">
        <span>{draft.length} / 2,000</span>
        <button
          className="secondary"
          disabled={!dirty || busy || conflict}
          onClick={async () => {
            const text = draft;
            const version = base.version;
            if (
              await onSave("notes", {
                sessionId: session.id,
                notes: text,
                version,
              })
            )
              setBase({ text, version: version + 1 });
          }}
        >
          Save notes <ArrowUpRight size={14} />
        </button>
      </div>
    </section>
  );
}

export function TrainingInsights({ sessions }: { sessions: Session[] }) {
  const [includeSamples, setIncludeSamples] = useState(false);
  const [exercise, setExercise] = useState("Bench press");
  const [metric, setMetric] = useState<"topWeight" | "volume" | "reps">(
    "topWeight",
  );
  const choices = [
    ...new Set(
      sessions
        .filter((s) => s.endedAt && (includeSamples || !s.demo))
        .flatMap((s) => s.sets.map((x) => x.exercise)),
    ),
  ].sort();
  const selected = choices.includes(exercise)
    ? exercise
    : choices[0] || "Bench press";
  const points = exerciseHistory(sessions, selected, includeSamples).slice(-12);
  const values = points.map((p) => p[metric]);
  const max = Math.max(1, ...values);
  const first = values[0] || 0,
    last = values.at(-1) || 0;
  const suffix = metric === "reps" ? "reps" : "lb";
  const delta = last - first;
  return (
    <section className="training-insights">
      <div className="section-heading">
        <div>
          <span className="eyebrow">MOVEMENT / BY MOVEMENT</span>
          <h2>Your working history.</h2>
        </div>
        <span className="eyebrow">LAST 12 SESSIONS</span>
      </div>
      <div className="insight-controls">
        <label>
          Exercise
          <select
            aria-label="Progress exercise"
            value={selected}
            onChange={(e) => setExercise(e.target.value)}
            disabled={!choices.length}
          >
            {choices.length ? (
              choices.map((x) => <option key={x}>{x}</option>)
            ) : (
              <option>Bench press</option>
            )}
          </select>
        </label>
        <label>
          Measure
          <select
            aria-label="Progress measure"
            value={metric}
            onChange={(e) => setMetric(e.target.value as typeof metric)}
          >
            <option value="topWeight">Heaviest set</option>
            <option value="volume">Total volume</option>
            <option value="reps">Total reps</option>
          </select>
        </label>
        {sessions.some((s) => s.demo) && (
          <label className="sample-toggle">
            <input
              type="checkbox"
              checked={includeSamples}
              onChange={(e) => setIncludeSamples(e.target.checked)}
            />{" "}
            Include sample workouts
          </label>
        )}
      </div>
      {!points.length ? (
        <p className="insight-empty">
          Finish a workout to establish your first benchmark. Your real progress
          stays separate from sample workouts.
        </p>
      ) : (
        <>
          <div className="insight-summary">
            <strong>
              {number(last)} <small>{suffix}</small>
            </strong>
            <span>
              {points.length < 2
                ? "First session recorded"
                : `${delta > 0 ? "+" : ""}${number(delta)} ${suffix} since ${date(points[0].session.startedAt)}`}
            </span>
          </div>
          <div
            className="trend-chart"
            role="img"
            aria-label={`${selected}, ${metric === "topWeight" ? "heaviest set" : metric === "volume" ? "total volume" : "total reps"}, ${points.length} sessions. Latest ${number(last)} ${suffix}. Detailed values below.`}
          >
            <svg
              viewBox="0 0 640 170"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <line x1="20" y1="145" x2="620" y2="145" className="trend-grid" />
              <line x1="20" y1="80" x2="620" y2="80" className="trend-grid" />
              <polyline
                points={values
                  .map(
                    (v, i) =>
                      `${values.length === 1 ? 320 : 20 + (i * 600) / (values.length - 1)},${145 - (v / max) * 125}`,
                  )
                  .join(" ")}
                className="trend-line"
              />
              {values.map((v, i) => (
                <circle
                  key={i}
                  cx={
                    values.length === 1
                      ? 320
                      : 20 + (i * 600) / (values.length - 1)
                  }
                  cy={145 - (v / max) * 125}
                  r="4"
                  className="trend-dot"
                />
              ))}
            </svg>
          </div>
          <div className="trend-values">
            {points.map((p) => (
              <div key={p.session.id}>
                <span>
                  {date(p.session.startedAt)}
                  {p.session.demo ? " · SAMPLE" : ""}
                </span>
                <strong>
                  {number(p[metric])} <small>{suffix}</small>
                </strong>
              </div>
            ))}
          </div>
          <p className="insight-footnote">
            {metric === "topWeight"
              ? "Heaviest recorded set, regardless of reps."
              : "Volume is weight × reps; reps include every recorded set."}{" "}
            Kilograms are converted to pounds. Bodyweight sets count toward
            reps; only added weight contributes to volume.
          </p>
        </>
      )}
    </section>
  );
}
