# Shared pages

- Keep layout, accessibility, and interaction changes independent of providers. Consume normalized tracks and store actions. Move provider URLs and artwork rules to helpers, catalog I/O to catalog adapters, and stream resolution to playback adapters.
- Use the same routes and views across web catalogs. Scope Home history, Favorites, and Search to the selected catalog; leave the queue and active playback intact.
