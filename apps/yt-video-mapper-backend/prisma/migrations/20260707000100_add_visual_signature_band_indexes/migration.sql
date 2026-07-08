CREATE INDEX IF NOT EXISTS mapper_media_signature_algorithm_type_idx
  ON mapper_media_signature (algorithm_version, signature_type);

CREATE INDEX IF NOT EXISTS mapper_media_signature_visual_phash_band_01_idx
  ON mapper_media_signature (algorithm_version, signature_type, (substring(signature->>'phash' from 1 for 2)))
  WHERE signature_type = 'visual_frame'::signature_type AND signature ? 'phash';

CREATE INDEX IF NOT EXISTS mapper_media_signature_visual_phash_band_03_idx
  ON mapper_media_signature (algorithm_version, signature_type, (substring(signature->>'phash' from 3 for 2)))
  WHERE signature_type = 'visual_frame'::signature_type AND signature ? 'phash';

CREATE INDEX IF NOT EXISTS mapper_media_signature_visual_phash_band_05_idx
  ON mapper_media_signature (algorithm_version, signature_type, (substring(signature->>'phash' from 5 for 2)))
  WHERE signature_type = 'visual_frame'::signature_type AND signature ? 'phash';

CREATE INDEX IF NOT EXISTS mapper_media_signature_visual_phash_band_07_idx
  ON mapper_media_signature (algorithm_version, signature_type, (substring(signature->>'phash' from 7 for 2)))
  WHERE signature_type = 'visual_frame'::signature_type AND signature ? 'phash';

CREATE INDEX IF NOT EXISTS mapper_media_signature_visual_phash_band_09_idx
  ON mapper_media_signature (algorithm_version, signature_type, (substring(signature->>'phash' from 9 for 2)))
  WHERE signature_type = 'visual_frame'::signature_type AND signature ? 'phash';

CREATE INDEX IF NOT EXISTS mapper_media_signature_visual_phash_band_11_idx
  ON mapper_media_signature (algorithm_version, signature_type, (substring(signature->>'phash' from 11 for 2)))
  WHERE signature_type = 'visual_frame'::signature_type AND signature ? 'phash';

CREATE INDEX IF NOT EXISTS mapper_media_signature_visual_phash_band_13_idx
  ON mapper_media_signature (algorithm_version, signature_type, (substring(signature->>'phash' from 13 for 2)))
  WHERE signature_type = 'visual_frame'::signature_type AND signature ? 'phash';

CREATE INDEX IF NOT EXISTS mapper_media_signature_visual_phash_band_15_idx
  ON mapper_media_signature (algorithm_version, signature_type, (substring(signature->>'phash' from 15 for 2)))
  WHERE signature_type = 'visual_frame'::signature_type AND signature ? 'phash';
