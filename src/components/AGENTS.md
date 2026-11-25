# Shared components

- Render normalized props or store state. Keep provider requests, payload parsing, and URL construction outside components.
- Keep catalog Settings and the welcome dialog browser-only. Use `catalogStore` for persistence and the two-visit limit.
