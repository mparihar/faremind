INSERT INTO system_configs (id, key, value, description, updated_by, created_at, updated_at)
VALUES (gen_random_uuid()::text, 'ai_recommendation_card_limit', '25', 'Number of flight result cards that display the Why FAREMIND AI recommends this section. Set to 0 to disable.', 'system', NOW(), NOW())
ON CONFLICT (key) DO NOTHING;
