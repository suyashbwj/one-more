import { DurableObject } from "cloudflare:workers";
import {
  StoreCore,
  AppError,
  EXERCISES,
  type DatabaseAdapter,
} from "../server/store-core.ts";
import { parseCommand } from "../server/commands.ts";
import {
  COOKIE,
  MAX_AGE,
  entryPage,
  issueToken,
  matches,
  validToken,
} from "../server/access-core.ts";
import { ZodError } from "zod";

interface Env {
  JOURNAL: DurableObjectNamespace<Journal>;
  ASSETS: Fetcher;
  APP_PASSWORD: string;
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_AGENT_ID?: string;
}
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const html = (error = false, status = 200) =>
  new Response(entryPage(error), {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

export class Journal extends DurableObject<Env> {
  store: StoreCore;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    const db: DatabaseAdapter = {
      exec: (query) => sql.exec(query),
      prepare: (query) => ({
        all: (...args) => sql.exec(query, ...args).toArray(),
        get: (...args) => sql.exec(query, ...args).toArray()[0],
        run: (...args) => {
          sql.exec(query, ...args).toArray();
        },
      }),
      transaction: (work) => ctx.storage.transactionSync(work),
      close: () => {},
    };
    this.store = new StoreCore(db);
    sql.exec(
      "CREATE TABLE IF NOT EXISTS access_attempts(ip TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL)",
    );
  }
  async fetch(request: Request): Promise<Response> {
    try {
      const path = new URL(request.url).pathname;
      if (path === "/login" && request.method === "POST") {
        const ip = request.headers.get("CF-Connecting-IP") || "unknown";
        const now = Date.now();
        const sql = this.ctx.storage.sql;
        sql.exec("DELETE FROM access_attempts WHERE expires<=?", now);
        const prior = sql
          .exec<{ count: number }>(
            "SELECT count FROM access_attempts WHERE ip=?",
            ip,
          )
          .toArray()[0];
        if (prior && prior.count >= 10)
          return new Response(
            "Too many attempts. Please try again in one minute.",
            { status: 429, headers: { "Retry-After": "60" } },
          );
        sql.exec(
          "INSERT INTO access_attempts VALUES(?,1,?) ON CONFLICT(ip) DO UPDATE SET count=count+1",
          ip,
          now + 60_000,
        );
        const form = new URLSearchParams(await request.text());
        if (!matches(form.get("password") || "", this.env.APP_PASSWORD))
          return html(true, 401);
        sql.exec("DELETE FROM access_attempts WHERE ip=?", ip);
        return new Response(null, {
          status: 303,
          headers: {
            Location: "/",
            "Set-Cookie": `${COOKIE}=${issueToken(this.env.APP_PASSWORD)}; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE}; Path=/`,
            "Cache-Control": "no-store",
          },
        });
      }
      const token =
        (request.headers.get("Cookie") || "")
          .split(";")
          .map((x) => x.trim())
          .find((x) => x.startsWith(`${COOKIE}=`))
          ?.slice(COOKIE.length + 1) || "";
      if (!validToken(token, this.env.APP_PASSWORD))
        return json(
          {
            error:
              "Your demo session expired. Refresh and enter the project password.",
          },
          401,
        );
      if (path === "/api/state" && request.method === "GET")
        return json({
          sessions: this.store.sessions(),
          hosted: true,
          exercises: EXERCISES,
          voiceConfigured: !!(
            this.env.ELEVENLABS_API_KEY && this.env.ELEVENLABS_AGENT_ID
          ),
        });
      if (path === "/api/export" && request.method === "GET") {
        const response = json({
          exportedAt: new Date().toISOString(),
          sessions: this.store.sessions(),
        });
        response.headers.set(
          "Content-Disposition",
          'attachment; filename="one-more-workouts.json"',
        );
        return response;
      }
      if (path === "/api/voice/signed-url" && request.method === "GET") {
        if (!this.env.ELEVENLABS_API_KEY || !this.env.ELEVENLABS_AGENT_ID)
          throw new AppError(
            503,
            "Voice is not configured. Manual logging still works.",
          );
        // One issuer per journal prevents repeated clicks from flooding ElevenLabs.
        const last =
          (await this.ctx.storage.get<number>("lastVoiceIssue")) || 0;
        if (Date.now() - last < 10_000)
          throw new AppError(
            429,
            "Please wait a few seconds before connecting again.",
          );
        await this.ctx.storage.put("lastVoiceIssue", Date.now());
        const response = await fetch(
          `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(this.env.ELEVENLABS_AGENT_ID)}`,
          {
            headers: { "xi-api-key": this.env.ELEVENLABS_API_KEY },
            signal: AbortSignal.timeout(12_000),
          },
        );
        if (!response.ok)
          throw new AppError(
            502,
            "Voice is temporarily unavailable. Check the daily allowance or use manual logging.",
          );
        return json(await response.json());
      }
      if (path === "/api/demo" && request.method === "POST") {
        this.store.seedDemo();
        return json({
          message:
            "Sample history added. These workouts are marked as demo data.",
        });
      }
      if (request.method !== "POST") return json({ error: "Not found." }, 404);
      let body: any;
      try {
        body = await request.json();
      } catch {
        throw new AppError(400, "Send a valid JSON request.");
      }
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw new AppError(400, "Send a valid request.");
      if (path === "/api/mutate")
        return json(
          this.store.execute(body.requestId, body.action, body.payload),
        );
      if (path === "/api/command") {
        if (typeof body.text !== "string" || body.text.length > 1000)
          throw new AppError(400, "Enter a command under 1,000 characters.");
        if (!EXERCISES.includes(body.exercise))
          throw new AppError(400, "Choose an exercise.");
        return json(
          parseCommand(
            body.text,
            this.store.sessions().find((s) => !s.endedAt) || null,
            body.exercise,
            body.unit === "kg" ? "kg" : "lb",
          ),
        );
      }
      return json({ error: "Not found." }, 404);
    } catch (error) {
      return json(
        {
          error:
            error instanceof AppError
              ? error.message
              : error instanceof ZodError
                ? "Check your inputs: weight 0–2,000, reps 1–200, and a valid exercise."
                : "The request could not be completed. Your saved workout is safe.",
        },
        error instanceof AppError
          ? error.status
          : error instanceof ZodError
            ? 400
            : 500,
      );
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") return json({ status: "ok" });
    if (!env.APP_PASSWORD || env.APP_PASSWORD.length < 16)
      return json(
        { error: "The demo is being configured. Please try again shortly." },
        503,
      );
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin)
      return json({ error: "Cross-origin requests are not allowed." }, 403);
    if (["POST", "PUT", "PATCH"].includes(request.method)) {
      // Stream and cap actual bytes; Content-Length alone is client-controlled.
      const reader = request.body?.getReader();
      let size = 0;
      const chunks: Uint8Array[] = [];
      if (reader)
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 32_768) {
            await reader.cancel();
            return json({ error: "Request too large." }, 413);
          }
          chunks.push(value);
        }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      request = new Request(request, { body: bytes });
    }
    let response: Response;
    if (
      url.pathname.startsWith("/api/") ||
      (url.pathname === "/login" && request.method === "POST")
    ) {
      response = await env.JOURNAL.get(
        env.JOURNAL.idFromName("portfolio-demo-v1"),
      ).fetch(request);
    } else {
      const token =
        (request.headers.get("Cookie") || "")
          .split(";")
          .map((x) => x.trim())
          .find((x) => x.startsWith(`${COOKIE}=`))
          ?.slice(COOKIE.length + 1) || "";
      response = validToken(token, env.APP_PASSWORD)
        ? await env.ASSETS.fetch(request)
        : html();
    }
    const safe = new Response(response.body, response);
    safe.headers.set("X-Content-Type-Options", "nosniff");
    safe.headers.set("X-Frame-Options", "DENY");
    safe.headers.set("Referrer-Policy", "same-origin");
    safe.headers.set("Cache-Control", "no-store");
    return safe;
  },
} satisfies ExportedHandler<Env>;
