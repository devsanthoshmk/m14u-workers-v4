# Browser controls

- Keep native keyboard activation on focused controls; the window-level player shortcuts are a fallback for unhandled events.
- Android uses the Media3 session for OS transport controls. Keep browser Media Session registration gated off on Android to avoid competing handlers.
