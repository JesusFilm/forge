"""New evaluation guard revision; never open a closed paid ledger with this guard."""
import importlib.util
import hashlib
import sqlite3
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "studio_closed_guard", Path(__file__).parents[1] / "model-comparison-1/reviewed-helpers/guard.py"
)
_old = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_old)
Rejected = _old.Rejected


class Guard(_old.Guard):
    """Exact bytes may execute once per admitted slot/run, across all owners."""

    def __init__(self, path, proposal):
        if proposal.get("dispatchGuardVersion") != "studio-request-replay-v2":
            raise Rejected("A new versioned evaluation manifest is required")
        if Path(path).exists():
            prior = sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True)
            try:
                if prior.execute("SELECT digest FROM batch").fetchone()[0] != _old.digest(proposal):
                    raise Rejected("Never migrate or reuse a closed evaluation ledger")
            finally:
                prior.close()
        super().__init__(path, proposal)
        self.db.execute("CREATE UNIQUE INDEX IF NOT EXISTS calls_run_request ON calls(slot,digest)")

    def reserve(self, slot, ordinal, attempt, admission, raw):
        try:
            return super().reserve(slot, ordinal, attempt, admission, raw)
        except sqlite3.IntegrityError:
            # The underlying transaction rolled back: no reservation was consumed.
            # Recheck ownership while serialized so a duplicate loser cannot stop
            # a concurrent winner that already owns this exact ordinal.
            self.db.execute("BEGIN IMMEDIATE")
            try:
                owned = self.db.execute("SELECT 1 FROM calls WHERE slot=? AND ordinal=?", (slot, ordinal)).fetchone()
                repeated = self.db.execute("SELECT 1 FROM calls WHERE slot=? AND digest=?", (slot, hashlib.sha256(raw).hexdigest())).fetchone()
                if not owned and repeated:
                    self.db.execute("UPDATE batch SET stopped=1")
                self.db.execute("COMMIT")
            except Exception:
                self.db.execute("ROLLBACK")
                raise
            if repeated:
                raise Rejected("Repeated outbound bytes in the same admitted run; no dispatch") from None
            raise
