# Shared pages

- Keep layout, accessibility, and interaction changes independent of provider changes. Consume normalized tracks and store actions; put provider URLs and artwork rules in helpers, catalog I/O in catalog adapters, and stream resolution in playback modules.
- Use separate commits for shared UI and provider changes. When porting a UI fix, cherry-pick only the UI commit and run `pnpm test:ui` on `main` and `web/render-jiosaavn`. Report any untested branch.
