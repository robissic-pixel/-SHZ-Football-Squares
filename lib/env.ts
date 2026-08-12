/**
 * `process.env.X!` only silences TypeScript — it does nothing at runtime.
 * If a required var is missing in Vercel's project settings, code that
 * used `!` would silently send "undefined" as a header/body value instead
 * of failing clearly. This throws a readable error naming exactly which
 * var is missing, at the point of use, instead of a confusing downstream
 * failure (e.g. Whop rejecting `Authorization: Bearer undefined`).
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable "${name}". Set it in Vercel → Project → Settings → Environment Variables.`
    );
  }
  return value;
}
