-- Enum expansion is committed before 0112 uses its new value. No activation.
ALTER TYPE "RecommendationPromotionStage" ADD VALUE IF NOT EXISTS 'owner_approved';
