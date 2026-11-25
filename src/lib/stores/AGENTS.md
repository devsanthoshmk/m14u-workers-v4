# Catalog stores

- Keep loading, cancellation, and normalized result state here; keep JioSaavn requests and response parsing in `src/services/catalog.ts`. Commit provider changes separately from shared UI changes.

- Search and suggestion requests have separate cancellation lanes. On clear, invalidate both; guard writes after body parsing as well as on errors so canceled responses cannot repopulate the store.
