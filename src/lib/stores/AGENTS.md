# Catalog stores

- Separate loading, cancellation, and result state from provider requests and payload mapping.

- Search and suggestion requests have separate cancellation lanes. Clear and catalog changes invalidate both; guard writes after body parsing and on errors so stale responses cannot repopulate the store. Android always requests YouTube.
