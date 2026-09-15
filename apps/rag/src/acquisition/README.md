# Acquisition

Fetch, discovery, extraction, and raw-document staging live here. Source policy
is declared in `src/registry`; fetch implementations are selected by the
composition root and remain behind the acquisition ports.

Operators should not invoke these modules directly. Use the guarded package
commands documented in
[`../../docs/ops/corpus-maintenance.md`](../../docs/ops/corpus-maintenance.md).
Acquisition writes staging rows only; indexing is the sole path that writes the
searchable corpus.
