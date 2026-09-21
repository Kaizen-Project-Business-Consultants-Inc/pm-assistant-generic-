-- Only one plan can be the most popular one.
--
-- Both Consultant Pro and Team carried highlight = 1. It went unnoticed because
-- Team was hidden from the pricing page; the moment it was shown, two cards
-- claimed "Most Popular", which tells a buyer nothing and reads as an error.
--
-- Pro keeps the badge: it is the plan a solo consultant — the buyer this product
-- is aimed at — should land on. Team is chosen because a firm needs seats, not
-- because it is popular.
UPDATE pricing_config SET highlight = 0 WHERE tier <> 'consultant_pro';
UPDATE pricing_config SET highlight = 1 WHERE tier = 'consultant_pro';
