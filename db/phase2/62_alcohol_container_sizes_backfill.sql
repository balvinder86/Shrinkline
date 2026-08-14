-- One-time backfill: sets container_size_ml for the remaining Alcohol
-- ingredients so recipe lines can be written in oz/ml/L instead of
-- being locked to "each" (see 60/61_ingredient_container_*). Already
-- applied directly to production; committed here for the record.
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
where category = 'Alcohol' and container_size_ml is null and container_size_g is null
  and name in ('Canyon Road Cabernet Sauvignon','Chardonnay','Pinot Grigio','Red Blend','Terlato Pinot Grigio','Chloe','J Roget');

update ingredients set container_size_ml = 355
where category = 'Alcohol' and container_size_ml is null and container_size_g is null
  and name = 'Olympia';

update ingredients set container_size_ml = 750
where category = 'Alcohol' and container_size_ml is null and container_size_g is null
  and name not in ('Bodizafa','Cider','ESB','Hazy','Heff','Kraken Stash','Mac & Jack','Mannys','Nutcase','Rainier','Rotator','Thrashers Brown','Thrashers Cider ','Thrashers IPA');
