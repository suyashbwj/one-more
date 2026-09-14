import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const COOKIE = "one_more_access";
export const MAX_AGE = 8 * 60 * 60;
const digest = (value: string) => createHash("sha256").update(value).digest();
export function matches(a: string, b: string) {
  return timingSafeEqual(digest(a), digest(b));
}
export function issueToken(secret: string, now = Date.now()) {
  const expiry = String(now + MAX_AGE * 1000);
  return `${expiry}.${createHmac("sha256", secret).update(expiry).digest("hex")}`;
}
export function validToken(token: string, secret: string, now = Date.now()) {
  const [expiry, signature, extra] = token.split(".");
  if (extra || !/^\d+$/.test(expiry || "") || !signature) return false;
  const remaining = Number(expiry) - now;
  return (
    remaining > 0 &&
    remaining <= MAX_AGE * 1000 &&
    matches(
      signature,
      createHmac("sha256", secret).update(expiry).digest("hex"),
    )
  );
}

export function entryPage(error = false) {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>One More · Come on in</title><style>
  *{box-sizing:border-box}body{margin:0;min-height:100svh;background:#f5f4ed;color:#252820;font:16px system-ui,sans-serif;display:grid;place-items:center;padding:24px}main{width:min(100%,440px)}.brand{font-weight:900;font-size:22px;letter-spacing:-1px}.mark{display:inline-block;background:#cee96b;padding:5px 12px;margin-right:8px}small{display:block;margin:60px 0 12px;letter-spacing:2px;text-transform:uppercase;font-size:11px}h1{font-size:clamp(40px,9vw,60px);line-height:1;letter-spacing:-3px;margin:0 0 20px}p{color:#62665b;line-height:1.6}label{display:block;font-size:13px;font-weight:600;margin:32px 0 8px}input,button{width:100%;font:inherit;padding:16px;border:1px solid #b8bbae;border-radius:4px}input{background:#fff}button{margin-top:12px;background:#252820;color:#fff;cursor:pointer;font-weight:650}input:focus,button:focus-visible{outline:3px solid #94a749;outline-offset:3px}.foot{font-size:12px;margin-top:28px;border-top:1px solid #d9dcd0;padding-top:20px}.error{color:#9a3029}a{color:inherit}</style></head><body><main><div class="brand"><span class="mark">+1</span>one more</div><small>A workout journal</small><h1>Less typing.<br>More lifting.</h1><p>Welcome to the working portfolio demo. Enter the project password to try it.</p>${error ? '<p class="error" role="alert">That password did not match. Try again.</p>' : ""}<form action="/login" method="post"><label for="password">Project password</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="200"><button type="submit">Open One More →</button></form><p class="foot">This is a shared demonstration journal. Please use sample workouts, not personal information. Voice sessions use ElevenLabs and are limited to 60 seconds.<br><a href="https://suyashbwj.github.io/one-more/">Watch the walkthrough</a> · <a href="https://github.com/suyashbwj/one-more">View source</a></p></main></body></html>`;
}
