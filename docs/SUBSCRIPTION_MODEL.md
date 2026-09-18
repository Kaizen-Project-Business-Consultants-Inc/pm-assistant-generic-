# Subscription Model — Kovarti PM

**Last updated:** July 10, 2026

---

## Overview

Single paid tier targeting individual consultants. No free tier — full-featured 14-day trial, then pay or downgrade to read-only.

---

## Trial

- **Duration:** 14 days from account creation
- **Credit card required:** No
- **Access:** All features, no restrictions
- **Trial expiry:** Account becomes read-only (see Post-Trial below)

---

## Paid Tier: Consultant

| Billing | Price | Notes |
|---------|-------|-------|
| Monthly | $25/mo | Non-refundable. Cancel anytime. |
| Annual | $250/yr (~$20.83/mo, 17% savings) | Pro-rated refund within first 30 days. Non-refundable after 30 days. |

### What's Included (Everything)

- Unlimited projects
- All AI features (Mjuzi chat, NL queries, auto-reschedule, meeting intelligence, predictive intelligence, EVM forecasting, Monte Carlo, lessons learned, task prioritization, scope creep detection, status reports)
- NL Workflow Builder + full DAG automation engine
- Gantt charts with drag-and-drop, dependencies (FS/SS/FF/SF + lag), critical path, baselines
- EVM dashboard
- Sprint/Agile + Kanban boards
- Resource management + workload heatmaps
- Stakeholder portal
- Custom report builder + scheduled delivery
- RAID management
- All export formats (CSV, PDF, MSPDI XML)
- API access + MCP integration
- File attachments (5GB storage)
- Dark mode, i18n (EN/FR/ES), time zone support

---

## Account States

There are exactly three, and an account is always in one of them. **A trial belongs to
the free tier only — no paid tier ever carries one.**

| State | `subscription_tier` | `subscription_status` | `trial_ends_at` | What they get |
|---|---|---|---|---|
| **Free (on trial)** | `trial` | `trialing` | set, 14 days out | Everything, until the date passes |
| **Free (trial spent)** | `trial` | `none` | in the past | Read-only |
| **Awaiting payment** | `trial` | `incomplete` | NULL | Nothing but their checkout |
| **Subscriber** | a paid tier | `active` | NULL | Everything on their plan |

### Awaiting payment is not the free tier

Someone who chose a paid plan and has not paid is **not** a free-tier customer — they
never chose free. They are held in `incomplete` with no trial and no access, and the
plan they were buying is remembered in `pending_tier` so their checkout can be resumed.
`subscription_tier` deliberately stays `trial` while they wait, because that column
grants feature access and an unpaid signup must not receive features it has not paid
for.

The account still exists rather than being refused outright, because Stripe needs
something to attach the payment to, a late confirmation needs somewhere to land, and
someone returning an hour later should not have to register again.

`PendingPaymentJob` (daily, 09:30) looks after these: it asks Stripe whether they in
fact paid, reminds them after 2 days, and deactivates the empty account after 14.

### Never strand a paying customer

The webhook is the normal way a payment is confirmed, but it can be late, dropped, or
fail. If that happens the customer has paid and the app does not know it — the worst
state in the system. Two guards:

1. **On return from checkout** the client calls `POST /stripe/reconcile`, which asks
   Stripe directly instead of waiting.
2. **The daily sweep** repeats that check for anything still `incomplete`.

The trial downgrade job is also restricted to `subscription_tier = 'trial'`, so it
cannot downgrade an account that has paid, and the trial reminder emails carry the same
restriction so a subscriber is never told their trial is expiring.

---

## Post-Trial / Unpaid Experience (Read-Only Mode)

When trial expires and user has no active subscription:

### Allowed (read-only)
- Log in and view all projects, tasks, schedules, dashboards
- View reports, analytics, EVM data
- Export data (CSV, PDF, MSPDI) — lets them take their data
- View notification history
- Access account/billing page to upgrade

### Blocked (write operations)
- Create or edit projects, tasks, schedules
- Create or edit workflows
- Use AI features (Mjuzi chat, NL queries, auto-reschedule, etc.)
- Create or edit reports, goals, resources
- Upload files
- Use stakeholder portal (create/edit)
- API write operations
- Sprint management (create, start, complete)
- Time logging
- Comments and activity

### UX Behavior
- Blocked actions show an inline upgrade prompt (not a redirect — keep them in context)
- Banner at top of app: "Your trial has ended. Upgrade to keep building." with CTA button
- Pricing page accessible from banner and account page
- Data is never deleted — it's always there waiting for them to subscribe

---

## Cancellation Policy

- **Monthly:** Cancel anytime. Access continues until end of current billing period. No refund for partial months.
- **Annual:** Cancel anytime. Access continues until end of annual period. Pro-rated refund available if requested within first 30 days of the annual subscription. Non-refundable after 30 days.
- **Resubscribe:** User can resubscribe at any time. All data is preserved.

---

## Stripe Configuration

### Products & Prices to Create

| Product | Price ID Env Var | Billing | Amount |
|---------|-----------------|---------|--------|
| Kovarti PM Consultant (Monthly) | `STRIPE_MONTHLY_PRICE_ID` | Recurring monthly | $25.00 USD |
| Kovarti PM Consultant (Annual) | `STRIPE_ANNUAL_PRICE_ID` | Recurring yearly | $250.00 USD |

### Checkout Flow
1. User clicks "Subscribe" on pricing page
2. `POST /api/v1/stripe/create-checkout-session` with `priceId` (monthly or annual)
3. Stripe Checkout opens (no trial — trial was the free 14 days)
4. On success: webhook updates `subscription_tier` to `consultant`, `subscription_status` to `active`
5. Redirect to app

### Webhook Events to Handle
- `checkout.session.completed` — activate subscription
- `customer.subscription.updated` — sync status changes
- `customer.subscription.deleted` — downgrade to read-only
- `invoice.payment_failed` — mark `past_due`, send notification
- `invoice.paid` — clear `past_due` status

---

## Implementation Plan

### Phase 1: Backend Gating Middleware
- Create `requireActiveSubscription` middleware
- Check: user has active/trialing subscription OR is admin
- Returns 403 with `{ error: 'Subscription required', upgradeUrl: '/pricing' }` on block
- Apply to all write routes (POST, PUT, PATCH, DELETE) except auth, stripe, and account routes
- AI routes get additional check (blocked for expired trials)

### Phase 2: Stripe Updates
- Create Consultant product + two prices (monthly/annual) in Stripe dashboard
- Update `createCheckoutSession` to accept `priceId` parameter (monthly or annual)
- Remove 14-day Stripe trial (trial is handled by app, not Stripe)
- Update webhook handler for new price IDs
- Add `STRIPE_MONTHLY_PRICE_ID` and `STRIPE_ANNUAL_PRICE_ID` env vars

### Phase 3: Database Changes
- Update `subscription_tier` ENUM: `'free' | 'consultant'` (drop 'pro' and 'business')
- Migration to rename existing 'pro' users to 'consultant'
- ~~Add `trial_started_at` field if not already tracked (for accurate trial expiry)~~
  Column added by migration 047 but never written; registration now sets it (migration
  116 backfills running trials and clears the stale trial stamp off paid accounts).

### Phase 4: Frontend Updates
- Redesign PricingPage: single tier with monthly/annual toggle
- Add trial-expired banner component
- Add upgrade prompts on blocked actions (inline, not redirect)
- Update AccountBillingPage for new tier name and pricing
- Remove Business tier "Contact Sales" CTA

### Phase 5: Refund Policy Display
- Add refund policy text to checkout flow
- Add terms to pricing page footer
- Store policy acceptance timestamp on subscription record

---

## Legal Text (Draft)

### Refund Policy

**Monthly subscriptions** are non-refundable. You may cancel at any time and your access will continue until the end of your current billing period.

**Annual subscriptions** are eligible for a pro-rated refund if requested within 30 days of purchase or renewal. After 30 days, annual subscriptions are non-refundable. You may cancel at any time and your access will continue until the end of your annual billing period.

To request a refund, contact support@kpbc.ca.

### Trial Terms

Your 14-day free trial begins when you create your account. No credit card is required. After the trial period, your account will be placed in read-only mode. You may subscribe at any time to restore full access. Your data is preserved indefinitely.
