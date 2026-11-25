# Shared pages

- Keep layout, accessibility, and interaction changes independent of providers. Consume normalized tracks and store actions. Move provider URLs and artwork rules to helpers, catalog I/O to catalog adapters, and stream resolution to playback adapters.
- Commit shared UI and provider changes separately. Cherry-pick only the shared UI commit to the other branch and run `pnpm test:ui` on both `main` and `web/render-jiosaavn`; report any untested branch.
