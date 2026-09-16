-- Fix: organizations.seat_price_cents DEFAULT was 3300 ($33) from migration 069.
-- Migration 111 changed pricing_config to $19/seat but did not update the column default.
-- New orgs created without an explicit seat_price_cents would get $33 instead of $19.
ALTER TABLE organizations
  ALTER COLUMN seat_price_cents SET DEFAULT 1900;
