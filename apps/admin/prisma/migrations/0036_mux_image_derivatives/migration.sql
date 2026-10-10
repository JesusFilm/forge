CREATE TABLE "mux_image_derivative" (
  "id" TEXT NOT NULL,
  "mux_video_id" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "params_hash" TEXT NOT NULL,
  "params" JSONB NOT NULL DEFAULT '{}',
  "source_url" TEXT NOT NULL,
  "lqip_url" TEXT NOT NULL,
  "blur_data_url" TEXT NOT NULL,
  "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "mux_image_derivative_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "mux_image_derivative"
  ADD CONSTRAINT "mux_image_derivative_mux_video_id_fkey"
  FOREIGN KEY ("mux_video_id") REFERENCES "mux_video"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "mux_image_derivative_mux_video_id_purpose_params_hash_key"
  ON "mux_image_derivative"("mux_video_id", "purpose", "params_hash");

CREATE INDEX "mux_image_derivative_purpose_idx"
  ON "mux_image_derivative"("purpose");
