const revisions = [];

export function saveRevision(record) {
  revisions.push({ ...record, createdAt: new Date().toISOString() });
  return revisions[revisions.length - 1];
}

export function listRevisions() {
  return revisions;
}
