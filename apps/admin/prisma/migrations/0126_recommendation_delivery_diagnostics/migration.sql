-- Additive request-owned evidence. Existing requests remain explicitly unknown;
-- no historical audio identity can be reconstructed for empty deliveries.
ALTER TABLE "recommendation_request"
  ADD COLUMN "delivery_diagnostics" JSONB;

ALTER TABLE "recommendation_request"
  ADD CONSTRAINT "recommendation_request_delivery_diagnostics_bound"
  CHECK ("delivery_diagnostics" IS NULL OR (
    jsonb_typeof("delivery_diagnostics") = 'object'
    AND octet_length("delivery_diagnostics"::text) <= 2048
  )) NOT VALID;

-- Enforce all new writes immediately without scanning the historical ledger
-- while holding the deployment DDL lock. Existing rows have NULL evidence.
