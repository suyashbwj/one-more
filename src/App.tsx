import React, { useEffect, useRef, useState } from "react";
import { useConversation, useConversationClientTool } from "@elevenlabs/react";
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  Check,
  Mic,
  MicOff,
  Clock,
  History,
  BarChart3,
  Dumbbell,
  Settings,
  ChevronRight,
  X,
  Flame,
  Headphones,
  CheckCheck,
  Trash2,
  Pencil,
  RotateCcw,
  Download,
  Pause,
  Play,
  Activity,
  ShieldCheck,
} from "lucide-react";
import type { Session, SetRecord } from "../server/store";
import "./style.css";
import {
  PreviousSession,
  SessionNotes,
  TrainingInsights,
} from "./components/TrainingTools";
import { filterHistory } from "./training";
function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (n) => n.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
type State = {
  sessions: Session[];
  exercises: string[];
  voiceConfigured: boolean;
  hosted?: boolean;
};
type Proposal = {
  action: string;
  payload: any;
  message: string;
  token: string;
};
const plans: Record<string, string[]> = {
  "Upper body": [
    "Bench press",
    "Incline dumbbell press",
    "Cable fly",
    "Shoulder press",
    "Lateral raise",
    "Triceps pushdown",
  ],
  "Lower body": [
    "Squat",
    "Romanian deadlift",
    "Leg press",
    "Leg curl",
    "Calf raise",
  ],
  "Pull day": [
    "Deadlift",
    "Lat pulldown",
    "Barbell row",
    "Seated cable row",
    "Biceps curl",
    "Pull-up",
  ],
};
const fmt = (n: number) => Math.round(n).toLocaleString();
const volume = (sets: SetRecord[]) =>
  sets.reduce(
    (v, s) => v + s.weight * s.reps * (s.unit === "kg" ? 2.20462 : 1),
    0,
  );
const elapsed = (start: string, end?: string | null) =>
  Math.max(
    0,
    Math.floor(((end ? +new Date(end) : Date.now()) - +new Date(start)) / 1000),
  );
const time = (n: number) =>
  `${Math.floor(n / 60)
    .toString()
    .padStart(2, "0")}:${(n % 60).toString().padStart(2, "0")}`;
async function api(path: string, body?: any) {
  const r = await fetch(
    "/api/" + path,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "Unable to connect. Try again.");
  return d;
}
function useStored<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      return (
        JSON.parse(localStorage.getItem("one-more:" + key) || "null") ??
        fallback
      );
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("one-more:" + key, JSON.stringify(value));
    } catch {}
  }, [key, value]);
  return [value, setValue] as const;
}
export default function App() {
  const [data, setData] = useState<State>({
    sessions: [],
    exercises: [],
    voiceConfigured: false,
  });
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("Workout");
  const [plan, setPlan] = useState("Upper body");
  const [selected, setSelected] = useStored("selected-exercise", "Bench press");
  const [extras, setExtras] = useStored<Record<string, string[]>>(
    "extra-exercises",
    {},
  );
  const [unit, setUnit] = useState<"lb" | "kg">("lb");
  const [weight, setWeight] = useState("135");
  const [reps, setReps] = useState("8");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [modal, setModal] = useState<"settings" | "finish" | "exercise" | null>(
    null,
  );
  const [editing, setEditing] = useState<SetRecord | null>(null);
  const [command, setCommand] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [reply, setReply] = useState("");
  const [tick, setTick] = useState(Date.now());
  const [restEnd, setRestEnd] = useStored<number | null>("rest-end", null);
  const [restPaused, setRestPaused] = useStored<number | null>(
    "rest-paused",
    null,
  );
  const [restLength, setRestLength] = useStored("rest-length", 90);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyScope, setHistoryScope] = useState("all");
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const proposalRef = useRef<Proposal | null>(null);
  const pending = useRef<{ action: string; payload: any; id: string } | null>(
    null,
  );
  const lock = useRef(false);
  const active = data.sessions.find((s) => !s.endedAt);
  const completed = data.sessions.filter((s) => s.endedAt);
  const currentPlan = active?.name || plan;
  const exercises = [
    ...new Set([
      ...(plans[currentPlan] || plans[plan]),
      ...(extras[currentPlan] || []),
      ...(active?.sets.map((s) => s.exercise) || []),
      selected,
    ]),
  ];
  const sets = active?.sets.filter((s) => s.exercise === selected) || [];
  const rest =
    restPaused ??
    (restEnd ? Math.max(0, Math.ceil((restEnd - tick) / 1000)) : 0);
  async function refresh() {
    try {
      setData(await api("state"));
      setLoaded(true);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    refresh();
    const t = setInterval(() => setTick(Date.now()), 1000);
    const focus = () => refresh();
    window.addEventListener("focus", focus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", focus);
    };
  }, []);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>("[role=dialog]");
    const items = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),a[href],input,select,textarea",
        ) || [],
      );
    items()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModal(null);
      if (e.key === "Tab") {
        const all = items();
        if (e.shiftKey && document.activeElement === all[0]) {
          e.preventDefault();
          all.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === all.at(-1)) {
          e.preventDefault();
          all[0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [modal]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    if (restEnd && rest === 0 && restPaused === null) {
      setRestEnd(null);
      setToast("Rest complete. Ready for one more?");
    }
  }, [rest, restEnd, restPaused]);
  useEffect(() => {
    if (active) {
      setPlan(active.name in plans ? active.name : "Upper body");
    }
  }, [active?.id]);
  async function mutate(action: string, payload: any) {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    const prev = pending.current;
    const id =
      prev &&
      prev.action === action &&
      JSON.stringify(prev.payload) === JSON.stringify(payload)
        ? prev.id
        : newId();
    pending.current = { action, payload, id };
    try {
      const result = await api("mutate", { requestId: id, action, payload });
      pending.current = null;
      await refresh();
      setToast(result.message);
      return true;
    } catch (e) {
      setError((e as Error).message);
      await refresh();
      setError((e as Error).message);
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function logSet(e: React.FormEvent) {
    e.preventDefault();
    if (!active) return;
    if (weight.trim() === "" || reps.trim() === "") return;
    const ok = await mutate(editing ? "edit" : "add", {
      sessionId: active.id,
      ...(editing ? { setId: editing.id, version: editing.version } : {}),
      exercise: selected,
      weight: Number(weight),
      reps: Number(reps),
      unit,
    });
    if (ok) {
      setEditing(null);
      setRestEnd(Date.now() + restLength * 1000);
      setRestPaused(null);
    }
  }
  function selectExercise(ex: string) {
    setSelected(ex);
    setEditing(null);
    const previous =
      active?.sets.filter((s) => s.exercise === ex).at(-1) ||
      completed.flatMap((s) => s.sets).find((s) => s.exercise === ex);
    if (previous) {
      setWeight(String(previous.weight));
      setReps(String(previous.reps));
      setUnit(previous.unit);
    }
    proposalRef.current = null;
    setProposal(null);
  }
  async function interpret(text: string) {
    proposalRef.current = null;
    setProposal(null);
    setReply("");
    try {
      const r = await api("command", { text, exercise: selected, unit });
      if (r.history) setTab("History");
      if (r.action) {
        r.token = newId();
        proposalRef.current = r;
        setProposal(r);
      }
      setReply(r.message);
      return JSON.stringify(
        r.action
          ? {
              status: "awaiting_user_confirmation",
              token: r.token,
              message: r.message,
            }
          : r,
      );
    } catch (e) {
      setError((e as Error).message);
      return "Command failed. No changes were saved.";
    }
  }
  async function confirmProposal(token: string) {
    const p = proposalRef.current;
    if (!p || p.token !== token)
      return "No matching pending change. Nothing was saved.";
    proposalRef.current = null;
    const ok = await mutate(p.action, p.payload);
    if (ok) {
      setProposal(null);
      setReply("Saved. Ready for the next one.");
      setCommand("");
      setRestEnd(Date.now() + restLength * 1000);
      setRestPaused(null);
      return "Change saved successfully.";
    }
    proposalRef.current = p;
    return "Save failed. Ask the user to review the on-screen error before retrying.";
  }
  const conversation = useConversation({
    onError: () =>
      setError(
        "Voice connection interrupted. Your saved sets are safe. You can reconnect or log manually.",
      ),
  });
  useConversationClientTool("prepare_workout_command", async ({ text }) =>
    typeof text === "string" ? interpret(text) : "A text command is required.",
  );
  useConversationClientTool("confirm_workout_command", async ({ token }) =>
    typeof token === "string"
      ? confirmProposal(token)
      : "A confirmation token is required.",
  );
  useConversationClientTool("get_workout_context", async () =>
    JSON.stringify({
      active,
      selectedExercise: selected,
      unit,
      history: completed.slice(0, 3),
    }),
  );
  useEffect(() => {
    if (conversation.status === "connected") {
      const t = setTimeout(() => {
        conversation.endSession();
        setToast(
          "Voice paused after 60 seconds to conserve your free minutes.",
        );
      }, 60000);
      return () => clearTimeout(t);
    }
  }, [conversation.status]);
  async function toggleVoice() {
    if (conversation.status === "connected") {
      await conversation.endSession();
      return;
    }
    if (!data.voiceConfigured) {
      setModal("settings");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      const d = await api("voice/signed-url");
      await conversation.startSession({
        signedUrl: d.signed_url,
        connectionType: "websocket",
      });
    } catch (e) {
      setError(
        (e as Error).message ||
          "Microphone unavailable. Check browser permissions.",
      );
    }
  }
  const weekly = completed.filter(
    (s) => Date.now() - +new Date(s.startedAt) < 7 * 86400000,
  );
  const best = completed
    .flatMap((s) => s.sets)
    .filter((s) => s.exercise === selected)
    .sort(
      (a, b) =>
        b.weight * (b.unit === "kg" ? 2.20462 : 1) -
        a.weight * (a.unit === "kg" ? 2.20462 : 1),
    )[0];
  return (
    <div className="app">
      <header className="masthead">
        <a className="brand" href="/" aria-label="One More home">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          one more<span className="brand-period">+</span>
        </a>
        <nav className="desktop-nav" aria-label="Main navigation">
          {["Workout", "History", "Progress"].map((name, i) => (
            <button
              key={name}
              aria-current={tab === name ? "page" : undefined}
              className={tab === name ? "nav-item active" : "nav-item"}
              onClick={() => setTab(name)}
            >
              <span className="nav-index">0{i + 1}</span>
              {name}
            </button>
          ))}
        </nav>
        <div className="masthead-right">
          <span className="local-status">
            <span />
            {data.hosted ? "SHARED DEMO" : "LOCAL JOURNAL"}
          </span>
          <button
            className="profile-button"
            onClick={() => setModal("settings")}
            aria-label="Open preferences"
          >
            S<span className="profile-label">Suyash</span>
            <Settings size={14} />
          </button>
        </div>
      </header>
      <main>
        <div className="page">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {new Date()
                  .toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })
                  .toUpperCase()}
              </div>
              <h1>
                {tab === "Workout"
                  ? "Training log."
                  : tab === "History"
                    ? "Session archive."
                    : "Progress, recorded."}
              </h1>
              <p>
                {tab === "Workout"
                  ? "A place for the work. A little less between you and your next set."
                  : tab === "History"
                    ? "Every workout, exactly as you left it."
                    : "The numbers behind the habit."}
              </p>
            </div>
            <span className="heading-badge">
              <span className="week-number">
                {String(weekly.length).padStart(2, "0")}
              </span>
              workouts this week
            </span>
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
              <button
                onClick={() => {
                  setError("");
                  refresh();
                }}
              >
                Retry
              </button>
            </div>
          )}
          {!loaded ? (
            <div className="empty">
              <Activity className="pulse" />
              <h2>Opening your training journal…</h2>
              <button onClick={refresh} className="secondary">
                Try again
              </button>
            </div>
          ) : tab === "Workout" ? (
            <>
              <section className={active ? "hero is-live" : "hero"}>
                <div className="hero-copy">
                  <span className="pill">
                    <span className={active ? "live-dot" : ""} />
                    {active ? "LIVE SESSION" : "NEXT SESSION / 01"}
                  </span>
                  <h2>{active ? active.name : plan}</h2>
                  <p>
                    {active
                      ? "Your session is saved as you go."
                      : `${(plans[plan] || []).length} movements. Start when you’re ready.`}
                  </p>
                  <div className="hero-actions">
                    {active ? (
                      <>
                        <span className="session-time">
                          <Clock size={16} />
                          {time(elapsed(active.startedAt))}
                        </span>
                        <span className="session-time">
                          <CheckCheck size={17} />
                          {active.sets.length}{" "}
                          {active.sets.length === 1 ? "set" : "sets"} logged
                        </span>
                        <button
                          className="finish-button"
                          onClick={() => setModal("finish")}
                        >
                          Finish workout <ArrowUpRight size={16} />
                        </button>
                      </>
                    ) : (
                      <>
                        <select
                          aria-label="Workout plan"
                          value={plan}
                          onChange={(e) => {
                            setPlan(e.target.value);
                            selectExercise(plans[e.target.value][0]);
                          }}
                        >
                          {Object.keys(plans).map((p) => (
                            <option key={p}>{p}</option>
                          ))}
                        </select>
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() => mutate("start", { name: plan })}
                        >
                          Start session <ArrowUpRight size={17} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className="hero-art" aria-hidden="true">
                  <div className="art-topline">
                    <span>OM—01</span>
                    <span>FORM / REPEAT</span>
                  </div>
                  <svg className="plate-art" viewBox="0 0 420 250" fill="none">
                    <defs>
                      <pattern
                        id="plate-hatch"
                        width="5"
                        height="5"
                        patternUnits="userSpaceOnUse"
                      >
                        <path d="M0 5L5 0" stroke="#888b81" strokeWidth=".5" />
                      </pattern>
                    </defs>
                    <path
                      d="M8 125H412M210 12V238"
                      stroke="#40433c"
                      strokeDasharray="3 6"
                    />
                    <g transform="translate(213 120) rotate(-24)">
                      <ellipse
                        cy="15"
                        rx="136"
                        ry="83"
                        fill="#1e201c"
                        stroke="#929588"
                      />
                      <path d="M-136 0V15M136 0V15" stroke="#929588" />
                      <ellipse
                        rx="136"
                        ry="83"
                        fill="#2a2d27"
                        stroke="#d3d5c8"
                      />
                      <ellipse rx="125" ry="76" stroke="#757b6c" />
                      <ellipse
                        rx="104"
                        ry="63"
                        fill="url(#plate-hatch)"
                        stroke="#a7ad98"
                      />
                      <ellipse
                        rx="89"
                        ry="54"
                        fill="#242720"
                        stroke="#b6bda6"
                      />
                      <ellipse
                        rx="37"
                        ry="23"
                        fill="#13150f"
                        stroke="#c9cfb9"
                      />
                      <ellipse cy="7" rx="30" ry="17" stroke="#727a64" />
                      <path
                        d="M-106 0H-51M51 0H106M0 -65V-32M0 32V65"
                        stroke="#d5ddc5"
                      />
                      <text
                        x="-23"
                        y="-37"
                        fill="#e6efcf"
                        fontSize="13"
                        fontFamily="monospace"
                        letterSpacing="4"
                      >
                        ONE
                      </text>
                      <text
                        x="-28"
                        y="49"
                        fill="#e6efcf"
                        fontSize="13"
                        fontFamily="monospace"
                        letterSpacing="3"
                      >
                        MORE
                      </text>
                    </g>
                    <path
                      d="M38 213H169M250 213H381M38 208V218M381 208V218"
                      stroke="#8d947d"
                    />
                    <text
                      x="179"
                      y="217"
                      fill="#dce4c8"
                      fontSize="10"
                      fontFamily="monospace"
                      letterSpacing="2"
                    >
                      +1 REP
                    </text>
                  </svg>
                  <div className="art-bottomline">
                    <span>THE WORK ADDS UP.</span>
                    <span className="art-cross">+</span>
                  </div>
                </div>
              </section>
              <div className="workspace-grid">
                <section className="session-panel">
                  <div className="section-heading">
                    <h2>
                      Movements{" "}
                      <span className="count">{exercises.length}</span>
                    </h2>
                    <button
                      className="text-button"
                      onClick={() => setModal("exercise")}
                    >
                      <Plus size={16} /> Add exercise
                    </button>
                  </div>
                  <div className="exercise-layout">
                    <div className="exercise-list">
                      {exercises.map((ex, i) => {
                        const count =
                          active?.sets.filter((s) => s.exercise === ex)
                            .length || 0;
                        return (
                          <button
                            key={ex}
                            className={
                              "exercise " + (selected === ex ? "selected" : "")
                            }
                            onClick={() => selectExercise(ex)}
                          >
                            <span
                              className={
                                "exercise-number " + (count >= 3 ? "done" : "")
                              }
                            >
                              {count >= 3 ? (
                                <Check size={15} />
                              ) : (
                                String(i + 1).padStart(2, "0")
                              )}
                            </span>
                            <span>
                              <strong>{ex}</strong>
                              <small>
                                {count
                                  ? `${count} ${count === 1 ? "set" : "sets"} logged`
                                  : "3 sets · 8–12 reps"}
                              </small>
                            </span>
                            {selected === ex ? (
                              <span className="selected-mark" />
                            ) : count > 0 ? (
                              <span className="tiny-count">{count}</span>
                            ) : null}
                          </button>
                        );
                      })}
                      <div className="plan-footnote">SELECT A MOVEMENT →</div>
                    </div>
                    <div className="set-panel">
                      <div className="exercise-title">
                        <div>
                          <span className="eyebrow">
                            {editing ? "EDITING A SET" : "SET LOG"}
                          </span>
                          <h3>{selected}</h3>
                        </div>
                        <span className="equipment-icon">
                          <Dumbbell size={21} />
                        </span>
                      </div>
                      <div className="last-time">
                        <History size={14} />
                        {best
                          ? `Previous best: ${best.weight} ${best.unit} × ${best.reps}`
                          : "No previous session recorded."}
                      </div>
                      <PreviousSession
                        sessions={data.sessions}
                        exercise={selected}
                        index={sets.length}
                        editing={!!editing}
                        onUse={(s) => {
                          setWeight(String(s.weight));
                          setReps(String(s.reps));
                          setUnit(s.unit);
                          setToast(
                            "Previous values loaded. Log the set when you finish.",
                          );
                        }}
                      />
                      <div className="set-table">
                        <div className="set-row table-head">
                          <span>SET</span>
                          <span>WEIGHT</span>
                          <span>REPS</span>
                          <span />
                        </div>
                        {sets.length ? (
                          sets.map((s, i) => (
                            <div
                              className={
                                "set-row " +
                                (editing?.id === s.id ? "editing-row" : "")
                              }
                              key={s.id}
                            >
                              <span className="set-index">{i + 1}</span>
                              <strong>
                                {s.weight} <small>{s.unit}</small>
                              </strong>
                              <strong>{s.reps}</strong>
                              <div className="row-actions">
                                <span className="set-check">
                                  <Check size={15} />
                                </span>
                                <button
                                  aria-label={`Edit set ${i + 1}`}
                                  className="tiny-button"
                                  onClick={() => {
                                    setEditing(s);
                                    setWeight(String(s.weight));
                                    setReps(String(s.reps));
                                    setUnit(s.unit);
                                  }}
                                >
                                  <Pencil size={13} />
                                </button>
                                <button
                                  aria-label={`Delete set ${i + 1}`}
                                  className="tiny-button"
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        `Remove set ${i + 1} of ${s.exercise}?`,
                                      )
                                    )
                                      mutate("delete", {
                                        sessionId: active!.id,
                                        setId: s.id,
                                        version: s.version,
                                      });
                                  }}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="no-sets">
                            <div className="empty-set-mark">
                              <Plus size={20} />
                            </div>
                            <p>No sets yet.</p>
                            <span>Enter your weight and reps below.</span>
                          </div>
                        )}
                      </div>
                      <form onSubmit={logSet} className="log-form">
                        <div className="input-labels">
                          <label htmlFor="weight">
                            Weight{" "}
                            <span className="unit-toggle">
                              <button
                                type="button"
                                className={unit === "lb" ? "chosen" : ""}
                                onClick={() => {
                                  if (unit !== "lb") {
                                    setWeight(
                                      String(
                                        Math.round(
                                          Number(weight) * 2.20462 * 10,
                                        ) / 10,
                                      ),
                                    );
                                    setUnit("lb");
                                  }
                                }}
                              >
                                lb
                              </button>
                              <button
                                type="button"
                                className={unit === "kg" ? "chosen" : ""}
                                onClick={() => {
                                  if (unit !== "kg") {
                                    setWeight(
                                      String(
                                        Math.round(
                                          (Number(weight) / 2.20462) * 10,
                                        ) / 10,
                                      ),
                                    );
                                    setUnit("kg");
                                  }
                                }}
                              >
                                kg
                              </button>
                            </span>
                          </label>
                          <label htmlFor="reps">Reps</label>
                        </div>
                        <div className="inputs">
                          <input
                            id="weight"
                            type="number"
                            inputMode="decimal"
                            min="0"
                            max="2000"
                            step="0.1"
                            required
                            value={weight}
                            onChange={(e) => setWeight(e.target.value)}
                          />
                          <span>×</span>
                          <input
                            id="reps"
                            type="number"
                            inputMode="numeric"
                            min="1"
                            max="200"
                            required
                            value={reps}
                            onChange={(e) => setReps(e.target.value)}
                          />
                        </div>
                        <button
                          className="primary log-button"
                          disabled={!active || busy}
                        >
                          {editing ? <Check size={17} /> : <Plus size={18} />}{" "}
                          {editing
                            ? "Save correction"
                            : `Log set ${sets.length + 1}`}
                          <span>↵</span>
                        </button>
                        {editing && (
                          <button
                            type="button"
                            className="text-button cancel-edit"
                            onClick={() => setEditing(null)}
                          >
                            Cancel correction
                          </button>
                        )}
                        {!active && (
                          <small className="start-hint">
                            Start a workout above to log your first set.
                          </small>
                        )}
                      </form>
                      <div className="save-note">
                        <ShieldCheck size={13} />{" "}
                        {data.hosted
                          ? "Saved to the shared demo journal"
                          : "Saved to your local training journal"}
                      </div>
                    </div>
                  </div>
                </section>
                <aside className="right-column">
                  <section className="voice-card">
                    <div className="card-label">
                      <span>
                        <span className="orange-dot" /> VOICE INPUT
                      </span>
                      <Headphones size={17} />
                    </div>
                    <div
                      className={
                        "voice-orb " +
                        (conversation.status === "connected" ? "listening" : "")
                      }
                    >
                      <div className="orb-core">
                        <span />
                        <span />
                        <span />
                        <span />
                        <span />
                        <span />
                        <span />
                      </div>
                    </div>
                    <h3>
                      {conversation.status === "connected"
                        ? conversation.isSpeaking
                          ? "Speaking."
                          : "Listening."
                        : "Say your set."}
                    </h3>
                    <p>“Bench press. 135 pounds. 8 reps.”</p>
                    <button
                      className="voice-button"
                      onClick={toggleVoice}
                      disabled={conversation.status === "connecting"}
                    >
                      {conversation.status === "connected" ? (
                        <MicOff size={17} />
                      ) : (
                        <Mic size={17} />
                      )}{" "}
                      {conversation.status === "connected"
                        ? "End conversation"
                        : conversation.status === "connecting"
                          ? "Connecting…"
                          : "Talk to One More"}
                    </button>
                    <span className="voice-foot">
                      {data.voiceConfigured
                        ? "ElevenLabs / Connected"
                        : "ElevenLabs / Not connected"}
                    </span>
                    <div className="command-divider">
                      <span>TEXT COMMAND</span>
                    </div>
                    <form
                      className="command-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (command.trim()) interpret(command);
                      }}
                    >
                      <input
                        aria-label="Workout command"
                        placeholder="135 lb for 8 reps…"
                        value={command}
                        onChange={(e) => setCommand(e.target.value)}
                        maxLength={1000}
                      />
                      <button
                        aria-label="Interpret command"
                        disabled={!command.trim()}
                      >
                        <ArrowRight size={17} />
                      </button>
                    </form>
                    {reply && (
                      <div className="command-reply" role="status">
                        {reply}
                        {proposal && (
                          <div className="proposal-actions">
                            <button
                              disabled={busy}
                              onClick={() => confirmProposal(proposal.token)}
                            >
                              <Check size={14} /> Confirm
                            </button>
                            <button
                              onClick={() => {
                                proposalRef.current = null;
                                setProposal(null);
                                setReply("No changes made.");
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                  <section className="rest-card">
                    <div className="section-heading">
                      <h3>
                        <Clock size={17} /> Rest timer
                      </h3>
                      <select
                        aria-label="Rest duration"
                        value={restLength}
                        onChange={(e) => setRestLength(Number(e.target.value))}
                      >
                        <option value={60}>60 sec</option>
                        <option value={90}>90 sec</option>
                        <option value={120}>120 sec</option>
                        <option value={180}>180 sec</option>
                      </select>
                    </div>
                    <div className="timer-line">
                      <span className="timer">{time(rest)}</span>
                      <div>
                        <button
                          aria-label={
                            rest > 0 && restPaused === null
                              ? "Pause rest"
                              : "Start rest"
                          }
                          className="timer-button"
                          onClick={() => {
                            if (rest > 0 && restPaused === null) {
                              setRestPaused(rest);
                            } else {
                              setRestEnd(
                                Date.now() + (restPaused || restLength) * 1000,
                              );
                              setRestPaused(null);
                            }
                          }}
                        >
                          {rest > 0 && restPaused === null ? (
                            <Pause size={18} />
                          ) : (
                            <Play size={18} />
                          )}
                        </button>
                        <button
                          aria-label="Reset rest timer"
                          className="timer-button reset"
                          onClick={() => {
                            setRestEnd(null);
                            setRestPaused(null);
                          }}
                        >
                          <RotateCcw size={16} />
                        </button>
                      </div>
                    </div>
                    <div className="timer-track">
                      <span
                        style={{
                          width: `${rest ? Math.min(100, (rest / restLength) * 100) : 0}%`,
                        }}
                      />
                    </div>
                    <p>
                      {rest
                        ? "Rest in progress."
                        : "Auto-starts after each set."}
                    </p>
                  </section>
                </aside>
              </div>
              {active && (
                <SessionNotes
                  key={active.id}
                  session={active}
                  onSave={mutate}
                  busy={busy}
                />
              )}
              <section className="bottom-stats">
                <div>
                  <span className="stat-icon">
                    <Dumbbell size={19} />
                  </span>
                  <div>
                    <small>SETS THIS SESSION</small>
                    <strong>
                      {active?.sets.length || 0}
                      <span> {active?.sets.length === 1 ? "set" : "sets"}</span>
                    </strong>
                  </div>
                </div>
                <div>
                  <span className="stat-icon">
                    <Activity size={19} />
                  </span>
                  <div>
                    <small>VOLUME LIFTED</small>
                    <strong>
                      {fmt(volume(active?.sets || []))}
                      <span> lb</span>
                    </strong>
                  </div>
                </div>
                <div>
                  <span className="stat-icon">
                    <CheckCheck size={19} />
                  </span>
                  <div>
                    <small>EXERCISES LOGGED</small>
                    <strong>
                      {new Set(active?.sets.map((s) => s.exercise)).size}
                      <span> / {exercises.length}</span>
                    </strong>
                  </div>
                </div>
              </section>
            </>
          ) : tab === "History" ? (
            <section className="history-section">
              <div className="section-heading">
                <h2>
                  Training journal{" "}
                  <span className="count">{completed.length}</span>
                </h2>
                <a className="secondary" href="/api/export" download>
                  <Download size={15} /> Export
                </a>
              </div>
              {completed.length > 0 && (
                <div className="history-filters">
                  <label>
                    Find a workout
                    <input
                      type="search"
                      aria-label="Search workout history"
                      placeholder="Workout, exercise, or notes…"
                      value={historyQuery}
                      onChange={(e) => setHistoryQuery(e.target.value)}
                    />
                  </label>
                  <label>
                    Show
                    <select
                      aria-label="History source"
                      value={historyScope}
                      onChange={(e) => setHistoryScope(e.target.value)}
                    >
                      <option value="all">All workouts</option>
                      <option value="real">My workouts</option>
                      <option value="sample">Sample workouts</option>
                    </select>
                  </label>
                  <span>
                    {
                      filterHistory(completed, historyQuery, historyScope)
                        .length
                    }{" "}
                    found
                  </span>
                </div>
              )}
              {completed.length ? (
                <div className="history-grid">
                  {!filterHistory(completed, historyQuery, historyScope)
                    .length && (
                    <p className="no-results">
                      No matching workouts. Try another exercise or clear your
                      search.
                    </p>
                  )}
                  {filterHistory(completed, historyQuery, historyScope).map(
                    (s) => (
                      <article
                        key={s.id}
                        className={
                          "history-card " +
                          (historyId === s.id ? "expanded" : "")
                        }
                      >
                        <button
                          className="history-open"
                          aria-expanded={historyId === s.id}
                          aria-label={`View ${s.name} from ${new Date(s.startedAt).toLocaleDateString()}`}
                          onClick={() =>
                            setHistoryId(historyId === s.id ? null : s.id)
                          }
                        >
                          <div className="history-card-top">
                            <span className="history-icon">
                              <Dumbbell size={22} />
                            </span>
                            <ArrowUpRight size={19} />
                          </div>
                          <small>
                            {new Date(s.startedAt).toLocaleDateString("en-US", {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            })}
                            {s.demo && " · SAMPLE"}
                          </small>
                          <h3>{s.name}</h3>
                          <p>
                            {s.sets.length}{" "}
                            {s.sets.length === 1 ? "set" : "sets"}{" "}
                            <span>·</span> {fmt(volume(s.sets))} lb{" "}
                            <span>·</span>{" "}
                            {Math.ceil(elapsed(s.startedAt, s.endedAt) / 60)}{" "}
                            min
                          </p>
                        </button>
                        {historyId === s.id && (
                          <div className="history-details">
                            {s.sets.map((x, i) => (
                              <div key={x.id}>
                                <span>
                                  {i + 1}. {x.exercise}
                                </span>
                                <strong>
                                  {x.weight} {x.unit} × {x.reps}
                                </strong>
                              </div>
                            ))}
                          </div>
                        )}
                        {historyId === s.id && (
                          <SessionNotes
                            key={s.id}
                            session={s}
                            onSave={mutate}
                            busy={busy}
                          />
                        )}
                      </article>
                    ),
                  )}
                </div>
              ) : (
                <Empty
                  title="No sessions recorded."
                  text="Finish a workout and it will be waiting for you here."
                  action={() => setTab("Workout")}
                  label="Start your first workout"
                />
              )}
            </section>
          ) : (
            <section className="progress-section">
              <TrainingInsights sessions={data.sessions} />
              <div className="progress-totals">
                <div>
                  <small>TOTAL WORKOUTS</small>
                  <strong>{completed.length}</strong>
                  <span>Times you showed up</span>
                </div>
                <div>
                  <small>LIFETIME VOLUME</small>
                  <strong>
                    {fmt(volume(completed.flatMap((s) => s.sets)))}
                  </strong>
                  <span>Pounds of effort</span>
                </div>
                <div>
                  <small>TOTAL SETS</small>
                  <strong>
                    {completed.reduce((n, s) => n + s.sets.length, 0)}
                  </strong>
                  <span>Small wins that add up</span>
                </div>
              </div>
              <div className="progress-chart">
                <div className="section-heading">
                  <div>
                    <h2>Your last 7 days</h2>
                    <p>Volume lifted · pounds</p>
                  </div>
                  <span className="pill">KEEP SHOWING UP</span>
                </div>
                <div className="bars">
                  {Array.from({ length: 7 }, (_, i) => {
                    const date = new Date();
                    date.setDate(date.getDate() - 6 + i);
                    const day = completed.filter(
                      (s) =>
                        new Date(s.startedAt).toDateString() ===
                        date.toDateString(),
                    );
                    const v = volume(day.flatMap((s) => s.sets));
                    const max = Math.max(
                      1,
                      ...Array.from({ length: 7 }, (_, j) => {
                        const d = new Date();
                        d.setDate(d.getDate() - 6 + j);
                        return volume(
                          completed
                            .filter(
                              (s) =>
                                new Date(s.startedAt).toDateString() ===
                                d.toDateString(),
                            )
                            .flatMap((s) => s.sets),
                        );
                      }),
                    );
                    return (
                      <div className="bar-column" key={i}>
                        <strong>{v ? fmt(v) : "—"}</strong>
                        <div className="bar-area">
                          <span
                            style={{
                              height: `${v ? Math.max(4, (v / max) * 100) : 2}%`,
                            }}
                          />
                        </div>
                        <small>
                          {date.toLocaleDateString("en-US", {
                            weekday: "short",
                          })}
                        </small>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="records">
                <h2>Personal bests</h2>
                {completed.length ? (
                  <div className="record-grid">
                    {[
                      ...new Set(
                        completed.flatMap((s) => s.sets.map((x) => x.exercise)),
                      ),
                    ].map((ex) => {
                      const best = completed
                        .flatMap((s) => s.sets)
                        .filter((s) => s.exercise === ex)
                        .sort(
                          (a, b) =>
                            b.weight * (b.unit === "kg" ? 2.20462 : 1) -
                            a.weight * (a.unit === "kg" ? 2.20462 : 1),
                        )[0];
                      return (
                        <div key={ex}>
                          <span>{ex}</span>
                          <strong>
                            {best.weight} <small>{best.unit}</small>
                            <em> × {best.reps}</em>
                          </strong>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p>Complete a workout to establish your first records.</p>
                )}
              </div>
            </section>
          )}
          <footer>
            <span className="footer-brand">one more.</span>
            <span>A personal record. Built one set at a time.</span>
            <span className="footer-right">
              <span /> EST. 2026
            </span>
          </footer>
        </div>
      </main>
      <nav className="mobile-nav">
        {[
          { name: "Workout", icon: Dumbbell },
          { name: "History", icon: History },
          { name: "Progress", icon: BarChart3 },
        ].map(({ name, icon: Icon }) => (
          <button
            key={name}
            onClick={() => setTab(name)}
            className={tab === name ? "active" : ""}
          >
            <Icon size={20} />
            <span>{name}</span>
          </button>
        ))}
      </nav>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === "settings"
                ? "Preferences"
                : modal === "finish"
                  ? "Finish workout"
                  : "Choose exercise"
            }
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="Close dialog"
              onClick={() => setModal(null)}
            >
              <X size={21} />
            </button>
            {modal === "finish" ? (
              <>
                <span className="modal-symbol">
                  <CheckCheck size={28} />
                </span>
                <div className="eyebrow">GOOD WORK, SUYASH.</div>
                <h2>One more in the books.</h2>
                <p>
                  {active?.sets.length || 0}{" "}
                  {active?.sets.length === 1 ? "set" : "sets"}.{" "}
                  {fmt(volume(active?.sets || []))} pounds moved.
                  <br />
                  Take a second to appreciate showing up.
                </p>
                <button
                  className="primary"
                  disabled={busy || !active?.sets.length}
                  onClick={async () => {
                    if (await mutate("finish", { sessionId: active!.id })) {
                      conversation.endSession();
                      setRestEnd(null);
                      setRestPaused(null);
                      setModal(null);
                      setTab("History");
                    }
                  }}
                >
                  Save & finish <Check size={17} />
                </button>
                {!active?.sets.length && (
                  <button
                    className="secondary"
                    onClick={async () => {
                      if (await mutate("discard", { sessionId: active!.id })) {
                        setModal(null);
                        setRestEnd(null);
                        setRestPaused(null);
                      }
                    }}
                  >
                    Discard empty workout
                  </button>
                )}
                <button className="text-button" onClick={() => setModal(null)}>
                  I have one more set in me
                </button>
              </>
            ) : modal === "exercise" ? (
              <>
                <div className="eyebrow">MAKE IT YOUR SESSION</div>
                <h2>Add an exercise.</h2>
                <input
                  className="search"
                  autoFocus
                  placeholder="Find your next movement…"
                  aria-label="Search exercises"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="exercise-picker">
                  {data.exercises
                    .filter((e) =>
                      e.toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((ex) => (
                      <button
                        key={ex}
                        onClick={() => {
                          setExtras({
                            ...extras,
                            [currentPlan]: [
                              ...new Set([...(extras[currentPlan] || []), ex]),
                            ],
                          });
                          selectExercise(ex);
                          setModal(null);
                          setSearch("");
                        }}
                      >
                        <Dumbbell size={17} />
                        {ex}
                        <Plus size={16} />
                      </button>
                    ))}
                </div>
              </>
            ) : (
              <>
                <div className="eyebrow">YOUR SPACE, YOUR WAY</div>
                <h2>A few things to know.</h2>
                <div className="setting-block">
                  <h3>
                    <Mic size={18} /> Voice connection{" "}
                    <span
                      className={
                        data.voiceConfigured ? "connected-tag" : "setup-tag"
                      }
                    >
                      {data.voiceConfigured ? "Ready" : "Not connected"}
                    </span>
                  </h3>
                  <p>
                    {data.voiceConfigured
                      ? "Your ElevenLabs agent is ready. Sessions automatically end after 60 seconds to conserve your allowance."
                      : data.hosted
                        ? "Voice is temporarily unavailable. You can still log sets manually or use text commands."
                        : "Add your ElevenLabs API key and agent ID to the local .env file, then restart the app. Your key stays on the server."}
                  </p>
                  <p>
                    You can use Wispr Flow in the quick-log text box right now.
                    Every interpreted change gets a confirmation before saving.
                  </p>
                </div>
                <div className="setting-block">
                  <h3>
                    <ShieldCheck size={18} /> Your training stays here
                  </h3>
                  <p>
                    {data.hosted
                      ? "This is a shared portfolio demonstration. Workouts persist online and are visible to anyone with the project password. Please use sample data, not personal information."
                      : "Workouts are stored in a local SQLite database and survive refreshes and server restarts. This version is a personal workspace, without cloud accounts or sync."}
                  </p>
                  <a className="text-button" href="/api/export" download>
                    <Download size={15} /> Export your workouts
                  </a>
                </div>
                {data.sessions.length === 0 && (
                  <div className="setting-block">
                    <h3>Take a look around</h3>
                    <p>
                      Add clearly labeled sample workouts to explore the history
                      and progress views.
                    </p>
                    <button
                      className="secondary"
                      onClick={async () => {
                        try {
                          await api("demo", {});
                          await refresh();
                          setToast("Sample history added.");
                          setModal(null);
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      Load sample history <ArrowRight size={15} />
                    </button>
                  </div>
                )}
                <button className="primary" onClick={() => setModal(null)}>
                  Let’s get back to it <ArrowRight size={17} />
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function Empty({
  title,
  text,
  action,
  label,
}: {
  title: string;
  text: string;
  action: () => void;
  label: string;
}) {
  return (
    <div className="empty">
      <span className="modal-symbol">
        <History size={28} />
      </span>
      <h2>{title}</h2>
      <p>{text}</p>
      <button className="primary" onClick={action}>
        {label}
        <ArrowRight size={17} />
      </button>
    </div>
  );
}
