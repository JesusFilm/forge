# feat-014 voiceover work

- [ ] Persist a real `voiceover` step in manager/CMS contracts
  manager + CMS component changes are in; generated `apps/cms/schema.graphql`
  and `packages/graphql/src/graphql-env.d.ts` still need a live CMS boot to
  pick up the new enum
- [x] Accept `generateVoiceover` on the create-job API
- [x] Wire voiceover generation and artifact tracking into the enrichment workflow
- [x] Expose authenticated artifact downloads for tracked outputs
- [x] Run focused tests, typecheck, and browser validation
