# Song rows and cards

- Render track links and cover candidates from helpers rather than building provider URLs in cards or rows. Follow [shared UI commit and test rules](../../pages/AGENTS.md).

- Normalize legacy `Song` inputs before sending them to the player; playback, queue, and favorites key on `TrackItem.id`. Catalog `duration` is display text, while playback and seek helpers take seconds.
