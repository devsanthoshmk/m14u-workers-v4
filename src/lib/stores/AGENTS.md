# Catalog stores

- Search and suggestion requests have separate cancellation lanes. On clear, invalidate both; guard writes after body parsing as well as on errors so canceled responses cannot repopulate the store.
