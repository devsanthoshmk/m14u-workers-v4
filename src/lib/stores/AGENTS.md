# Catalog stores

- Separate loading, cancellation, and result state from provider requests and payload mapping. Keep provider changes out of shared UI commits.

- Search and suggestion requests have separate cancellation lanes. On clear, invalidate both; guard writes after body parsing as well as on errors so canceled responses cannot repopulate the store.
