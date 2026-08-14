-- One-time backfill: sets container_size_ml for Thrasher's Pub's
-- remaining Alcohol ingredients so recipe lines can be written in
-- oz/ml/L instead of being locked to "each" (see
-- 60/61_ingredient_container_*). Already applied directly to
-- production; committed here for the record.
--
-- Scoped to restaurant_id explicitly, not just ingredient name —
-- these bottle-size assumptions (spirits default to 750ml for this
-- tenant specifically, per an explicit owner confirmation) are true
-- for Thrasher's, not a safe default for any other tenant that
-- happens to stock an identically-named product. Only one tenant
-- exists as of this writing, so name-only matching would have been a
-- no-op difference today — this is a forward-looking guard, not a fix
-- for an actual leak.
--
-- - Wine: 750ml, the standard bottle size.
-- - Olympia: 355ml — a packaged (canned/bottled) beer.
-- - Everything else still-unset in Alcohol: 750ml, the confirmed
--   default for this tenant's spirits (standard "fifth"), except a
--   short list of names that sound like draft/tap pours or are too
--   ambiguous to classify confidently — those are left null
--   deliberately; a keg's real size varies too much to guess safely,
--   and getting it wrong would silently distort pour cost.

update ingredients set container_size_ml = 750
where restaurant_id = 'fa2a2def-a8ba-472d-b98f-ae916f4cb743' -- Thrasher's Pub
  and category = 'Alcohol' and container_size_ml is null and container_size_g is null
  and name in ('Canyon Road Cabernet Sauvignon','Chardonnay','Pinot Grigio','Red Blend','Terlato Pinot Grigio','Chloe','J Roget');

update ingredients set container_size_ml = 355
where restaurant_id = 'fa2a2def-a8ba-472d-b98f-ae916f4cb743' -- Thrasher's Pub
  and category = 'Alcohol' and container_size_ml is null and container_size_g is null
  and name = 'Olympia';

update ingredients set container_size_ml = 750
where restaurant_id = 'fa2a2def-a8ba-472d-b98f-ae916f4cb743' -- Thrasher's Pub
  and category = 'Alcohol' and container_size_ml is null and container_size_g is null
  and name not in ('Bodizafa','Cider','ESB','Hazy','Heff','Kraken Stash','Mac & Jack','Mannys','Nutcase','Rainier','Rotator','Thrashers Brown','Thrashers Cider ','Thrashers IPA');
