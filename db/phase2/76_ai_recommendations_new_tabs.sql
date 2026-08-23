-- Widens ai_recommendations/ai_recommendation_dismissals' tab check
-- constraints to add three new insights tabs: product_mix, waste,
-- variance — see insights/src/{productMix,waste,variance}.ts for the
-- real-data context each is grounded in.
alter table ai_recommendations drop constraint ai_recommendations_tab_check;
alter table ai_recommendations add constraint ai_recommendations_tab_check
  check (tab in ('food_cost', 'inventory', 'invoices', 'recipes', 'product_mix', 'waste', 'variance'));

alter table ai_recommendation_dismissals drop constraint ai_recommendation_dismissals_tab_check;
alter table ai_recommendation_dismissals add constraint ai_recommendation_dismissals_tab_check
  check (tab in ('food_cost', 'inventory', 'invoices', 'recipes', 'product_mix', 'waste', 'variance'));
