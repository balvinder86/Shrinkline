-- Inventory Count lines now record the unit actually counted in (a
-- keg-tracked beer counted in oz and converted back to fractional
-- kegs, a case-purchased item counted directly in cases, etc.) —
-- previously only a bare quantity was stored, implicitly assumed to
-- already be in the ingredient's own native purchase unit. Matches
-- recipe_lines/waste_log's convention of storing what was actually
-- entered, not a pre-converted number, so a past count stays legible
-- on its own terms later.
alter table inventory_count_lines add column if not exists unit text not null default 'each';
