# Kovarti PM — Launch Day Checklist

**Target date:** September 7, 2026
**Domain:** kovarti.com

---

## Pre-Launch (Do Before Sep 7)

### Stripe: Switch to Live Mode
The production `.env` currently uses **test keys** (`sk_test_*`, `pk_test_*`). Before accepting real payments:

1. Go to https://dashboard.stripe.com (switch to Live mode toggle)
2. Create products and prices in **live mode** matching the test ones:
   - **Consultant Basic:** $19/mo, $190/yr
   - **Consultant Pro:** $29/mo, $290/yr
   - (Optional) **SME:** $33/seat/mo, $330/seat/yr
   - (Optional) **Enterprise:** $79/mo, $790/yr
   - **Token Top-Up:** $5 one-time (500K tokens)
3. Create the **20% launch coupon** in live mode (if using founder offer)
4. Set up a **webhook endpoint** in live mode:
   - URL: `https://kovarti.com/api/v1/stripe/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`, `charge.refunded`
5. Update `/opt/pm-app/.env` on production server:

```bash
ssh -i ~/.ssh/"ssh-key-2026-07-08 (1).key" ubuntu@147.5.127.251
sudo nano /opt/pm-app/.env
```

Replace these values:
```
STRIPE_SECRET_KEY=sk_live_XXXXXXXXX
STRIPE_PUBLISHABLE_KEY=pk_live_XXXXXXXXX
STRIPE_WEBHOOK_SECRET=whsec_XXXXXXXXX
STRIPE_CONSULTANT_BASIC_MONTHLY_PRICE_ID=price_XXXXXXXXX
STRIPE_CONSULTANT_BASIC_ANNUAL_PRICE_ID=price_XXXXXXXXX
STRIPE_CONSULTANT_PRO_MONTHLY_PRICE_ID=price_XXXXXXXXX
STRIPE_CONSULTANT_PRO_ANNUAL_PRICE_ID=price_XXXXXXXXX
STRIPE_TOPUP_PRICE_ID=price_XXXXXXXXX
STRIPE_LAUNCH_COUPON_ID=XXXXXXXXX
```

6. Restart the app: `sudo systemctl restart pm-app`
7. Test a checkout flow with a real card (Stripe live mode) — subscribe, verify webhook fires, verify tier changes in the app

### Email Deliverability
- [ ] Send a test email from `noreply@kovarti.com` and verify it arrives (not in spam)
- [ ] Verify DNS records for kovarti.com: SPF, DKIM, DMARC
  - Check at https://mxtoolbox.com/SuperTool.aspx
- [ ] Test the registration verification email flow end-to-end

---

## Launch Day (Sep 7)

### 1. Deploy the Live Site

```bash
# From your local machine:
bash deploy.sh prod --skip-tests
```

The prelaunch countdown is now **opt-in** via `--prelaunch` flag. Without it, the full app (login, register, pricing) is live.

### 2. Verify Production

- [ ] Visit https://kovarti.com — should show the live landing page (not countdown)
- [ ] Click "Get Started" — should go to /register
- [ ] Register a new account — verify email arrives, login works
- [ ] Visit /pricing — verify all tier cards show, subscribe buttons work
- [ ] Start a checkout — verify Stripe opens in **live mode** (no test banner)
- [ ] Check /roadmap, /guide, /terms, /privacy — all accessible
- [ ] Login as admin — verify dashboard loads

### 3. Post-Launch

- [ ] Submit sitemap to Google Search Console (see SEO_PLAN.md Phase 3)
- [ ] Post launch announcement on social media
- [ ] Monitor error logs: `ssh ubuntu@147.5.127.251 'sudo journalctl -u pm-app -f'`
- [ ] Monitor Stripe dashboard for successful payments
- [ ] Check for any 5xx errors in the first hour

---

## Rollback Plan

If something goes wrong after launch:

### Re-enable Prelaunch Mode
```bash
bash deploy.sh prod --skip-tests --prelaunch
```
This puts the countdown page back up while you fix the issue.

### Revert Stripe to Test Mode
Update `/opt/pm-app/.env` on prod to swap live keys back to test keys, then restart:
```bash
sudo systemctl restart pm-app
```

### Emergency Restart
```bash
ssh -i ~/.ssh/"ssh-key-2026-07-08 (1).key" ubuntu@147.5.127.251 'sudo systemctl restart pm-app'
```

---

## Current Production Status

| Setting | Value | Status |
|---------|-------|--------|
| `APP_URL` | `https://kovarti.com` | OK |
| `CORS_ORIGIN` | `https://kovarti.com` | OK |
| `RESEND_FROM_EMAIL` | `noreply@kovarti.com` | OK |
| `LOG_LEVEL` | `info` | OK |
| `LAUNCH_OFFER_ENABLED` | `true` | OK |
| `STRIPE_LAUNCH_COUPON_ID` | Set | OK |
| `MULTI_TENANT_ENABLED` | Verify | Check on server |
| `AI_ENABLED` | Verify | Check on server |
| Stripe keys | `sk_test_*` / `pk_test_*` | **NEEDS LIVE KEYS** |
| Stripe price IDs | Test mode IDs | **NEEDS LIVE IDS** |
| Stripe webhook | Test mode secret | **NEEDS LIVE SECRET** |

---

*Last updated: August 26, 2026*
