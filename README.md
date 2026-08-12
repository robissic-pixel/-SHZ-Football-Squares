# SHZ Football Squares — Sweepstakes Build

Paid entries go through Whop Checkout; free entries go through an
Alternative Method of Entry (AMOE) form. Both give identical odds, since
row/column digits are randomized only once the board fills — nobody's
square choice affects their win chance.

**This is engineering scaffolding, not legal advice.** Have a Texas
attorney review the AMOE flow, your official rules page, and prize
disclosures before you take real money.

## 1. Push this code to your repo

Copy these files into `robissic-pixel/SHZ-Football-Squares`, commit, and
push to `main`. Vercel will redeploy automatically once it's connected.

## 2. Add a database (Vercel KV)

In your Vercel project → **Storage** tab → **Create Database** → choose
**KV** (Redis-based). Once created, Vercel auto-adds the `KV_*` env vars
to your project — you don't need to copy them manually.

## 3. Get your Whop credentials

In your Whop dashboard:
1. **Developer** tab → create an API key → copy it into `WHOP_API_KEY`
2. Create a **Plan** for a single square ($10, one-time) → copy its ID into `WHOP_PLAN_ID`
3. **Developer → Webhooks** → Create Webhook → point it at
   `https://<your-app>.vercel.app/api/webhook/whop` → subscribe to
   `payment.succeeded` and `payment.failed` → copy the secret (after
   `whsec_`) into `WHOP_WEBHOOK_SECRET`

## 4. Set remaining env vars in Vercel

Project → **Settings → Environment Variables**:
- `APP_URL` — your deployed URL, no trailing slash
- `ADMIN_SECRET` — any long random string (protects the digit-randomize endpoint)

## 5. Deploy

Redeploy from the Vercel dashboard (or push another commit). Visit your
URL — you should see the 10x10 grid.

## 6. Test before going live

Whop has a test mode — use test card numbers to confirm a square locks
automatically after "payment," and that a webhook retry doesn't
double-lock a square (the handler dedupes by `webhook-id`).

## 7. At kickoff

Once the board fills (or your cutoff time hits), call:

```bash
curl -X POST https://<your-app>.vercel.app/api/admin/randomize \
  -H "x-admin-secret: <your ADMIN_SECRET>"
```

This randomly assigns 0-9 to each row and column, one time only. After
this, the board should be taken out of "open for entry" mode — this
scaffold doesn't auto-close entries, so add a simple flag check in
`app/page.tsx` / `app/api/checkout/route.ts` for your actual cutoff time.

## What still needs a lawyer's eyes

- **Official Rules page** — required for sweepstakes: entry period, odds
  disclosure, eligibility (age/state restrictions), how AMOE works, prize
  value, void-where-prohibited language
- Whether Texas requires AMOE to include a **mail-in** option, not just a
  web form
- Prize payout mechanics and any 1099 / tax reporting for winners
- Whether "art piece" NFTs need their own terms if you still want them as
  a collectible layer on top of this
