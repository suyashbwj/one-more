import { EXERCISES, type Session } from "./store-core.ts";
const aliases: Record<string, string> = {
  bench: "Bench press",
  incline: "Incline dumbbell press",
  fly: "Cable fly",
  "overhead press": "Shoulder press",
  shoulder: "Shoulder press",
  lateral: "Lateral raise",
  triceps: "Triceps pushdown",
  squat: "Squat",
  rdl: "Romanian deadlift",
  "romanian deadlift": "Romanian deadlift",
  "leg press": "Leg press",
  "leg curl": "Leg curl",
  calf: "Calf raise",
  deadlift: "Deadlift",
  pulldown: "Lat pulldown",
  "barbell row": "Barbell row",
  "cable row": "Seated cable row",
  curl: "Biceps curl",
  "pull up": "Pull-up",
};
export function parseCommand(
  text: string,
  session: Session | null,
  selected: string,
  unit: "lb" | "kg",
) {
  const t = text.toLowerCase().trim();
  if (/-\s*\d|\b\d+\.\d+\s*reps?\b|\b(don’t|don't|do not|cancel)\b/.test(t))
    return {
      message:
        "No changes made. Use a nonnegative weight and a whole number of reps.",
    };
  if (/\b(lb|lbs|pounds?)\b/.test(t) && /\b(kg|kilos?|kilograms?)\b/.test(t))
    return { message: "Use one weight unit per command: pounds or kilograms." };
  if (!session)
    return { message: "Start a workout first, then tell me your set." };
  if (/\b(history|last time|previous workout)\b/.test(t))
    return { history: true, message: "Your previous workouts are in History." };
  if (/\b(delete|remove|undo|finish|end workout)\b/.test(t))
    return {
      message:
        "Use the set menu to remove a set, or Finish workout to end the session. That keeps these changes intentional.",
    };
  const exact = EXERCISES.filter((e) => t.includes(e.toLowerCase())).sort(
    (a, b) => b.length - a.length,
  )[0];
  const alias = Object.entries(aliases)
    .sort((a, b) => b[0].length - a[0].length)
    .find(([a]) => new RegExp(`\\b${a}\\b`).test(t));
  const exercise = exact || alias?.[1] || selected;
  const units = /\b(kg|kilograms?|kilos?)\b/.test(t)
    ? "kg"
    : /\b(lb|lbs|pounds?)\b/.test(t)
      ? "lb"
      : unit;
  if (/\b(actually|correct|change|edit|instead)\b/.test(t)) {
    const sets = session.sets.filter((s) => s.exercise === exercise);
    const ordinal = t.match(/\b(first|second|third|fourth|fifth|last)\b/);
    const numbered = t.match(/set\s*(\d+)/);
    let index = numbered
      ? Number(numbered[1]) - 1
      : ordinal
        ? ["first", "second", "third", "fourth", "fifth"].indexOf(ordinal[1])
        : -1;
    if (ordinal?.[1] === "last") index = sets.length - 1;
    if (index < 0 && !ordinal && !numbered)
      return {
        message: "Which set should I correct? Try “Change set 2 to 7 reps.”",
      };
    const target = sets[index];
    if (!target)
      return {
        message: `I can’t find that set for ${exercise}. Select the exercise and specify an existing set number.`,
      };
    const reps = t.match(/(?:to\s+)?(\d+)\s*(?:reps?|repetitions)\b/);
    const weight = t.match(
      /(\d+(?:\.\d+)?)\s*(?:lb|lbs|pounds?|kg|kilos?|kilograms?)\b/,
    );
    if (!reps && !weight)
      return {
        message:
          "Tell me the value and unit, for example “Change set 2 to 7 reps.”",
      };
    return {
      action: "edit",
      payload: {
        sessionId: session.id,
        setId: target.id,
        version: target.version,
        exercise,
        weight: weight ? Number(weight[1]) : target.weight,
        reps: reps ? Number(reps[1]) : target.reps,
        unit: weight ? units : target.unit,
      },
      message: `Update ${exercise}, set ${index + 1} to ${weight ? weight[1] : target.weight} ${weight ? units : target.unit} × ${reps ? reps[1] : target.reps}?`,
    };
  }
  const weight = t.match(
    /(\d+(?:\.\d+)?)\s*(?:lb|lbs|pounds?|kg|kilos?|kilograms?)\b/,
  );
  const reps = t.match(/(\d+)\s*(?:reps?|repetitions)\b/);
  const pair = t.match(
    /(\d+(?:\.\d+)?)\s*(?:lb|lbs|pounds?|kg|kilos?|kilograms?)?\s*(?:x|×|for|by)\s*(\d+)/,
  );
  if (!(weight && reps) && !pair)
    return {
      message:
        "Try “Bench press 135 lb for 8 reps.” Include weight and reps so I don’t have to guess.",
    };
  const w = Number(weight?.[1] ?? pair?.[1]);
  const r = Number(reps?.[1] ?? pair?.[2]);
  if (w > 2000 || r < 1 || r > 200)
    return {
      message:
        "That looks outside the supported range. Check the weight and reps.",
    };
  return {
    action: "add",
    payload: {
      sessionId: session.id,
      exercise,
      weight: w,
      reps: r,
      unit: units,
    },
    message: `Log ${exercise}: ${w} ${units} × ${r}?`,
  };
}
