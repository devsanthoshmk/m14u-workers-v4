# Song rows and cards

- Normalize legacy `Song` inputs before sending them to the player; playback, queue, and favorites key on `TrackItem.id`. Catalog `duration` is display text, while playback and seek helpers take seconds.
