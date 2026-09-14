import express, { type Express } from "express";
import {
  COOKIE,
  MAX_AGE,
  matches,
  issueToken,
  validToken,
  entryPage,
} from "./access-core.ts";
export { matches, issueToken, validToken } from "./access-core.ts";
export function installAccess(
  app: Express,
  password: string | undefined,
  secure: boolean,
) {
  if (!password) return;
  if (password.length < 16)
    throw new Error("APP_PASSWORD must contain at least 16 characters.");
  const attempts = new Map<string, { count: number; expires: number }>();
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.post(
    "/login",
    express.urlencoded({ extended: false, limit: "1kb" }),
    (req, res) => {
      const now = Date.now();
      for (const [key, value] of attempts)
        if (value.expires <= now) attempts.delete(key);
      const ip = req.ip || "unknown";
      const attempt = attempts.get(ip) || { count: 0, expires: now + 60_000 };
      attempt.count++;
      attempts.set(ip, attempt);
      if (attempt.count > 10 || attempts.size > 10_000) {
        res.setHeader("Retry-After", "60");
        return res
          .status(429)
          .send("Too many attempts. Please try again in one minute.");
      }
      if (
        typeof req.body.password !== "string" ||
        !matches(req.body.password, password)
      )
        return res.status(401).type("html").send(entryPage(true));
      attempts.delete(ip);
      res.cookie(COOKIE, issueToken(password), {
        httpOnly: true,
        secure,
        sameSite: "strict",
        maxAge: MAX_AGE * 1000,
        path: "/",
      });
      res.redirect(303, "/");
    },
  );
  app.use((req, res, next) => {
    const token =
      (req.headers.cookie || "")
        .split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith(`${COOKIE}=`))
        ?.slice(COOKIE.length + 1) || "";
    if (validToken(token, password)) return next();
    if (req.path.startsWith("/api/"))
      return res
        .status(401)
        .json({
          error:
            "Your demo session expired. Refresh and enter the project password.",
        });
    res.status(200).type("html").send(entryPage());
  });
}
