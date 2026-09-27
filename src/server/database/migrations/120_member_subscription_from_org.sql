-- Team members invited after their organisation paid (or while it was on its trial) were
-- created with subscription_status 'none' (direct invites) or without the trial end date
-- (invite links), so every change they made was refused with "Your trial has ended".
-- Give those members their organisation's plan. Only non-viewer, non-owner members whose
-- own record says they have nothing; the owner's own record stays authoritative. Viewers are
-- free accounts and skip the check anyway. Safe to run twice.
UPDATE users u
  JOIN organizations o ON o.id = u.organization_id
   SET u.subscription_tier = o.subscription_tier,
       u.subscription_status = o.subscription_status,
       u.trial_ends_at = CASE WHEN o.subscription_status = 'active' THEN NULL ELSE o.trial_ends_at END
 WHERE u.role <> 'viewer'
   AND u.id <> o.owner_user_id
   AND o.subscription_status IN ('active', 'past_due', 'trialing')
   AND (u.subscription_status = 'none' OR u.subscription_status IS NULL
        OR (u.subscription_status = 'trialing' AND u.trial_ends_at IS NULL));
