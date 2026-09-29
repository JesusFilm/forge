# RAG Consumer Access

RAG consumers are known callers of the retrieval service. Their access lifecycle
and request history belong to the RAG context.

## Language

**Consumer**:
A named caller with a stable identity, owners, and one current retrieval
credential. Its name and identity stay reserved through revocation.

**Suspension**:
A reversible pause of a consumer's retrieval access. Its current credential is
retained for a later resumption.

**Revocation**:
An immediate invalidation of the current credential. The consumer stays visible
and retains its name, owners, usage, and audit history.

**Restoration**:
Restoration of a revoked consumer's access under the same identity with a newly
issued credential. The revoked credential remains invalid.
