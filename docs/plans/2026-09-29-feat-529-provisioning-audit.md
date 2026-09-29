---
title: "Audit applied RAG usage role provisioning"
type: docs
status: complete
date: 2026-09-29
---

Record the already-applied production role/ACL and service-vault changes requested
by Jaco. Publish exact safe write scope and verification, link the usage runbook
and feat-529, and keep its incomplete activation status explicit. Do not rerun
provisioning, touch credentials or issue further production mutations.

Validation: reconcile the audit against the executed operator source, repeat only
the merged read-only privilege verifiers, inspect secret-safe role flags, and check
Markdown formatting, links and the RAG lane guard. Full feat-529 completion and
Railway activation are outside this documentation PR.
