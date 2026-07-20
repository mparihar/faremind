SELECT calculation_model, fixed_amount, percentage_value, provider_scope, cabin_scope, fee_type, active
FROM platform_fee_rules
WHERE fee_type = 'SERVICE_FEE' AND active = true AND deleted_at IS NULL
ORDER BY priority DESC;
