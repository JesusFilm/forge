-- A shadow decision and promotion approval authorize one exact append-only
-- configuration. Serving state changes through the control/promotion tables;
-- mutating a manifest in place would let old evidence authorize new behavior.
CREATE FUNCTION "prevent_recommendation_strategy_manifest_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'recommendation strategy manifests are immutable';
END;
$$;

CREATE TRIGGER "recommendation_strategy_manifest_immutable"
BEFORE UPDATE OR DELETE ON "recommendation_strategy_manifest"
FOR EACH ROW EXECUTE FUNCTION "prevent_recommendation_strategy_manifest_mutation"();

COMMENT ON FUNCTION "prevent_recommendation_strategy_manifest_mutation"() IS
  'Append a new versioned manifest instead of changing configuration already bound to shadow, approval, assignment, or delivery evidence.';
