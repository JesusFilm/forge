-- A project has one durable authoring cycle. There is no client-provided reset key.
CREATE TABLE short_narration_allowance (
 project_id varchar(128) PRIMARY KEY REFERENCES short(id) ON DELETE RESTRICT,
 extra_passes integer NOT NULL DEFAULT 0 CHECK (extra_passes >= 0)
);
CREATE TABLE short_narration_admission (
 run_id text PRIMARY KEY REFERENCES short_production_run(id) ON DELETE RESTRICT,
 project_id varchar(128) NOT NULL REFERENCES short(id) ON DELETE RESTRICT,
 consumes_pass boolean NOT NULL,
 plan jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX short_narration_admission_project ON short_narration_admission(project_id);
CREATE FUNCTION guard_short_narration_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Narration admission evidence is immutable';
END;
$$;
CREATE TRIGGER short_narration_admission_immutable BEFORE UPDATE OR DELETE ON short_narration_admission
 FOR EACH ROW EXECUTE FUNCTION guard_short_narration_admission();
