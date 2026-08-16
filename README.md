# SHZ Football Squares — Sweepstakes Build

Two independent 10x10 boards — **Silver ($10/square)** and **Gold
($20/square)** — each with its own squares, its own digit draw, and its
own entry cutoff. Paid entries go through Whop Checkout; free entries go
through an Alternative Method of Entry (AMOE) form. Both give identical
odds on a given board, since row/column digits are randomized only once
that board's entries close — nobody's square choice affects their win
chance.

**This is engineering scaffolding, not legal advice.** Have a Texas
attorney review the AMOE flow, your official rules page, and prize
disclosures before you take real money.

## 1. Push this code to your repo

Copy these files into `robissic-pixel/SHZ-Football-Squares`, commit, and
push to `main`. Vercel will redeploy automatically once it's connected.

## 2. Add a database (Upstash Redis via Vercel Marketplace)

In your Vercel project → **Storage** tab → **Create Database** →
**Upstash** → **Upstash for Redis** (not the "Redis"/"Redis Cloud"
listing — different provider, different client). During setup, set the
**Custom Environment Variable Prefix** to `KV` so the generated vars match
what `@vercel/kv` expects (`KV_REST_API_URL`, `KV_REST_API_TOKEN`).

## 3. Get your Whop credentials

In your Whop dashboard:
1. **Developer** tab → create an API key → copy it into `WHOP_API_KEY`
2. Create **two Plans** — one per board:
   - $10 one-time plan → its ID goes in `WHOP_PLAN_ID_SILVER`
   - $20 one-time plan → its ID goes in `WHOP_PLAN_ID_GOLD`
3. **Developer → Webhooks** → Create Webhook → point it at
   `https://<your-app>.vercel.app/api/webhook/whop` → subscribe to
   `payment.succeeded` and `payment.failed` → copy the secret (after
   `whsec_`) into `WHOP_WEBHOOK_SECRET`. One webhook covers both boards —
   the board is carried through in the checkout metadata.

## 4. Set remaining env vars in Vercel

Project → **Settings → Environment Variables**:
- `APP_URL` — your deployed URL, no trailing slash
- `ADMIN_SECRET` — any long random string (protects the digit-randomize endpoint)
- `LOCK_COMBO` — the member front-door combo, as a comma-separated list of
  numbers 1-100, e.g. `LOCK_COMBO=15,76,89,34,56,23`. Visitors see only
  the logo and a plain numbered keypad (no prices, no team names, no
  rules) until they tap these numbers **in this exact order**. Share the
  combo with your members however you'd share a door code (group chat,
  text, etc).
- `LOCK_SECRET` — any long random string, used to sign the unlock cookie
  so it can't be forged. Different from `ADMIN_SECRET` — don't reuse it.

This lock is a **soft gate**, not a real security boundary — it keeps
casual visitors and search engines from seeing pricing/rules before
you're ready, but a determined person could still call the API routes
directly. The real protection around money is still Whop checkout and
the webhook signature check. See `lib/lock.ts` for details.

Unlock sessions last **9 hours** per visitor (cookie-based) before they'd
need to re-enter the combo.

## 5. Deploy

Redeploy from the Vercel dashboard (or push another commit). Visit your
URL — you should land on the member lock screen (logo + numbered keypad
only) instead of the board. Enter your `LOCK_COMBO` in order to see the
Silver/Gold tab switcher and the 10x10 grid.

## 6. Test before going live

Whop has a test mode — use test card numbers to confirm a square locks
automatically after "payment" **on the correct board**, and that a
webhook retry doesn't double-lock a square (the handler dedupes by
`webhook-id`). Also test the free AMOE form on both boards, and confirm
the same email is rejected on a second attempt for the *same* board but
accepted once on the *other* board.

The site now has a full admin panel built in (click "Admin login" and
enter your `ADMIN_SECRET`) — from there you can rename teams, set the
house cut and forward/backward payout split, draw numbers, manually
assign or release a square (e.g. someone paid you in cash), watch the
pending-checkout queue, enter quarter scores, and see computed winners.
The same `ADMIN_SECRET` unlocks admin mode on both boards.

## 7. At kickoff — randomize each board separately

Each board is closed independently by calling this once per board:

```bash
curl -X POST https://<your-app>.vercel.app/api/admin/randomize \
  -H "x-admin-secret: <your ADMIN_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"board": "silver"}'

curl -X POST https://<your-app>.vercel.app/api/admin/randomize \
  -H "x-admin-secret: <your ADMIN_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"board": "gold"}'
```

This randomly assigns 0-9 to each row and column for that board, one time
only. As soon as this succeeds for a board, both the paid checkout and
free AMOE routes automatically start rejecting new entries for that
specific board — the other board is unaffected until you randomize it too.

## What still needs a lawyer's eyes

- **Official Rules page** — required for sweepstakes: entry period, odds
  disclosure, eligibility (age/state restrictions), how AMOE works, prize
  value, void-where-prohibited language. Consider whether the two boards
  need to be disclosed as separate sweepstakes/entry pools.
- Whether Texas requires AMOE to include a **mail-in** option, not just a
  web form
- Prize payout mechanics and any 1099 / tax reporting for winners
- Whether "art piece" NFTs need their own terms if you still want them as
  a collectible layer on top of this
