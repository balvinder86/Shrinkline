alter table vendors add column if not exists category text not null default 'food_beverage';

alter table vendors drop constraint if exists vendors_category_check;
alter table vendors add constraint vendors_category_check
  check (category in ('food_beverage','utilities','maintenance','rent','insurance','other'));
