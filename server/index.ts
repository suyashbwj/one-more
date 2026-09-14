import express from "express";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { installAccess } from "./access.ts";
import { Store, AppError, EXERCISES } from "./store.ts";
import { parseCommand } from "./commands.ts";
import { ZodError } from "zod";
try {
  process.loadEnvFile(".env");
} catch {}
const dbPath = process.env.DB_PATH || "data/one-more.sqlite";
mkdirSync(dirname(dbPath), { recursive: true });
const store = new Store(dbPath);
const app = express();
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
if (process.env.RAILWAY_ENVIRONMENT_ID && !process.env.APP_PASSWORD)
  throw new Error("Hosted deployments require APP_PASSWORD.");
app.disable("x-powered-by");
app.get("/healthz", (_req, res) => res.json({ status: "ok" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  const origin = req.headers.origin;
  const expectedOrigin = process.env.APP_ORIGIN || `${req.protocol}://${req.get("host")}`;
  if (origin && origin !== expectedOrigin) return res.status(403).json({ error: "Cross-origin requests are not allowed." });
  next();
});
installAccess(app, process.env.APP_PASSWORD, process.env.COOKIE_SECURE === "1");
app.use(express.json({ limit: "32kb" }));
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  const origin = req.headers.origin;
  if (origin && origin !== `${req.protocol}://${req.get("host")}`)
    return res
      .status(403)
      .json({ error: "Cross-origin requests are not allowed." });
  next();
});
app.get("/api/state", (_req, res) =>
  res.json({
    sessions: store.sessions(),
    exercises: EXERCISES,
    voiceConfigured: !!(
      process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_AGENT_ID
    ),
  }),
);
app.post("/api/mutate", (req, res) =>
  res.json(
    store.execute(req.body.requestId, req.body.action, req.body.payload),
  ),
);
app.post("/api/demo", (_req, res) => {
  store.seedDemo();
  res.json({
    message: "Sample history added. These workouts are marked as demo data.",
  });
});
app.post("/api/command", (req, res) => {
  if (typeof req.body.text !== "string" || req.body.text.length > 1000)
    throw new AppError(400, "Enter a command under 1,000 characters.");
  if (!EXERCISES.includes(req.body.exercise))
    throw new AppError(400, "Choose an exercise.");
  res.json(
    parseCommand(
      req.body.text,
      store.sessions().find((s) => !s.endedAt) || null,
      req.body.exercise,
      req.body.unit === "kg" ? "kg" : "lb",
    ),
  );
});
app.get("/api/export", (_req, res) => {
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="one-more-workouts.json"',
  );
  res.json({
    exportedAt: new Date().toISOString(),
    sessions: store.sessions(),
  });
});
app.get("/api/voice/signed-url", async (_req, res) => {
  if (!process.env.ELEVENLABS_API_KEY || !process.env.ELEVENLABS_AGENT_ID)
    throw new AppError(
      503,
      "Voice needs an ElevenLabs API key and agent ID. Manual logging and dictation into the command box work now.",
    );
  const upstream = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(process.env.ELEVENLABS_AGENT_ID)}`,
    {
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY },
      signal: AbortSignal.timeout(12000),
    },
  );
  if (!upstream.ok)
    throw new AppError(
      502,
      "ElevenLabs could not start a session. Check your credentials and remaining credits.",
    );
  res.json(await upstream.json());
});
app.use("/api", (err: any, _req: any, res: any, _next: any) =>
  res
    .status(
      err instanceof AppError
        ? err.status
        : err instanceof ZodError
          ? 400
          : 500,
    )
    .json({
      error:
        err instanceof ZodError
          ? "Check your inputs: weight 0–2,000, reps 1–200, and a valid exercise."
          : err instanceof AppError
            ? err.message
            : "The request could not be completed. Your saved workout is safe.",
    }),
);
if (process.env.NODE_ENV === "production") {
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
app.listen(
  Number(process.env.PORT) || 4317,
  process.env.HOST || "127.0.0.1",
  () =>
    console.log(
      `One More is running at http://localhost:${process.env.PORT || 4317}`,
    ),
);
