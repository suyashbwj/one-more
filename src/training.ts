import type { Session, SetRecord } from "../server/store";
export const pounds = (s: SetRecord) =>
  s.weight * (s.unit === "kg" ? 2.20462 : 1);
export function exerciseHistory(
  sessions: Session[],
  exercise: string,
  includeSamples = false,
) {
  return sessions
    .filter(
      (s) =>
        s.endedAt &&
        (includeSamples || !s.demo) &&
        s.sets.some((x) => x.exercise === exercise),
    )
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
    .map((s) => {
      const sets = s.sets.filter((x) => x.exercise === exercise);
      return {
        session: s,
        sets,
        topWeight: Math.max(...sets.map(pounds)),
        volume: sets.reduce((n, x) => n + pounds(x) * x.reps, 0),
        reps: sets.reduce((n, x) => n + x.reps, 0),
      };
    });
}
export function filterHistory(
  sessions: Session[],
  query: string,
  scope: string,
) {
  const q = query.trim().toLowerCase();
  return sessions.filter(
    (s) =>
      s.endedAt &&
      (scope === "all" || (scope === "sample" ? s.demo : !s.demo)) &&
      [s.name, s.notes || "", ...s.sets.map((x) => x.exercise)].some((value) =>
        value.toLowerCase().includes(q),
      ),
  );
}
