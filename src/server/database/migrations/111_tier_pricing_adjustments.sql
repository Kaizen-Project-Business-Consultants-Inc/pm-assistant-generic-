-- Migration 111: Tier pricing adjustments (September 2026 competitive review)
-- 1. SME: $33/seat -> $19/seat (min 3 seats = $57/mo floor)
-- 2. Pro: 5 viewer invites -> 15
-- 3. Trial: AI tokens 0 -> 5K (exploration budget)

-- SME pricing: $33/seat -> $19/seat
UPDATE pricing_config
SET monthly_price_cents = 1900,
    annual_price_cents = 19000
WHERE tier = 'sme';

-- Pro: increase viewer invites from 5 to 15
UPDATE pricing_config
SET viewer_limit = 15,
    viewer_limit_label = '15'
WHERE tier = 'consultant_pro';

-- Trial: set AI token budget to 5K for exploration
UPDATE pricing_config
SET ai_tokens_monthly = 5000,
    ai_tokens_label = '5K',
    ai_tokens_description = '~10 AI chats to explore Mjuzi'
WHERE tier = 'trial';
