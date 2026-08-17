-- Keep reviewed operator acceptance distinct from automatic qualification.
ALTER TYPE "WatchSearchCandidateQualificationStatus"
  ADD VALUE 'operator_accepted' AFTER 'passed';
