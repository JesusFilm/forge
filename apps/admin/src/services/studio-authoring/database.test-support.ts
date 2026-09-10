/** Fresh full-migration regression database owned by the render task. Existing
 * predecessor allowlists remain intact; this does not admit arbitrary URLs. */
export const STUDIO_RENDER_TEST_DATABASE_URL =
  "postgresql://tataihono@127.0.0.1:55460/forge_studio_460_fresh"

export const SHORTS_MODEL_TEST_DATABASE_URL =
  "postgresql://tataihono@localhost:54963/shorts_model_test?host=/tmp/forge-shorts-model-db"
