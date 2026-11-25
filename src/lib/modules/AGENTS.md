# Playback adapters

- This directory owns provider stream resolution, probing, retries, and URL selection. Return normalized stream data to the player store. Keep Workers/Invidious and Render/JioSaavn changes in provider-only commits; do not port these commits with shared UI fixes.
