# CLAUDE.md — RAG contracts

This package owns shared HTTP contract definitions for `apps/rag` consumers.
It does not own retrieval implementation, environment parsing, database types,
or consumer policy. Keep exports runtime-neutral and preserve `/v1` compatibility.
