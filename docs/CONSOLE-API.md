# m14u Console API — Quick Reference

Access via `window.m14u` in browser console.

## Navigation
| Function | Description | Example |
|---|---|---|
| `route(path)` | Navigate to route | `m14u.route('/search')` |
| `currentRoute()` | Get current path | `m14u.currentRoute()` |

## Search
| Function | Description | Example |
|---|---|---|
| `search(query, filter?)` | Search, returns results | `await m14u.search('believer')` |
| `suggest(query)` | Get suggestions | `await m14u.suggest('bel')` |
| `clearSearch()` | Clear search state | `m14u.clearSearch()` |

## Playback
| Function | Description | Example |
|---|---|---|
| `play(songOrIndex?)` | Play by index, string search, or song object | `await m14u.play('believer')` |
| `pause()` | Pause playback | `m14u.pause()` |
| `toggle()` | Toggle play/pause | `m14u.toggle()` |
| `next()` | Next track | `m14u.next()` |
| `prev()` | Previous track | `m14u.prev()` |
| `seek(seconds)` | Seek to time | `m14u.seek(30)` |
| `nowPlaying()` | Get current song info | `m14u.nowPlaying()` |

## Volume
| Function | Description | Example |
|---|---|---|
| `volume(level?)` | Get or set volume (0-1) | `m14u.volume(0.5)` |
| `mute()` | Mute | `m14u.mute()` |
| `unmute()` | Unmute | `m14u.unmute()` |
| `toggleMute()` | Toggle mute | `m14u.toggleMute()` |

## Queue
| Function | Description | Example |
|---|---|---|
| `queue.list()` | Get queue array | `m14u.queue.list()` |
| `queue.add(song)` | Add to end | `m14u.queue.add(song)` |
| `queue.addNext(song)` | Add as next | `m14u.queue.addNext(song)` |
| `queue.remove(index)` | Remove by index | `m14u.queue.remove(2)` |
| `queue.clear()` | Clear queue | `m14u.queue.clear()` |
| `queue.playAt(index)` | Play queue item | `m14u.queue.playAt(0)` |
| `queue.reorder(from, to)` | Move item | `m14u.queue.reorder(0, 3)` |
| `queue.length()` | Queue size | `m14u.queue.length()` |

## Shuffle & Repeat
| Function | Description | Example |
|---|---|---|
| `shuffle()` | Toggle shuffle | `m14u.shuffle()` |
| `repeat(mode?)` | Get or set: 'off'/'one'/'all' | `m14u.repeat('all')` |

## Favorites
| Function | Description | Example |
|---|---|---|
| `favorites.list()` | Get favorites | `m14u.favorites.list()` |
| `favorites.toggle(song)` | Toggle favorite | `m14u.favorites.toggle(song)` |
| `favorites.isFav(videoId)` | Check favorite | `m14u.favorites.isFav('abc')` |
| `favorites.playAll()` | Play all favorites | `await m14u.favorites.playAll()` |
| `favorites.shufflePlay()` | Shuffle play favorites | `await m14u.favorites.shufflePlay()` |
| `favorites.count()` | Favorite count | `m14u.favorites.count()` |

## History
| Function | Description | Example |
|---|---|---|
| `history()` | Get listening history | `m14u.history()` |

## UI Panels
| Function | Description | Example |
|---|---|---|
| `panels.toggleQueue()` | Toggle queue panel | `m14u.panels.toggleQueue()` |
| `panels.toggleLyrics()` | Toggle lyrics panel | `m14u.panels.toggleLyrics()` |
| `panels.toggleSidebar()` | Toggle sidebar | `m14u.panels.toggleSidebar()` |
| `panels.openQueue()` | Open queue | `m14u.panels.openQueue()` |
| `panels.closeQueue()` | Close queue | `m14u.panels.closeQueue()` |
| `panels.openLyrics()` | Open lyrics | `m14u.panels.openLyrics()` |
| `panels.closeLyrics()` | Close lyrics | `m14u.panels.closeLyrics()` |
| `panels.state()` | Get panel states | `m14u.panels.state()` |

## Wait (Deterministic)
| Function | Description | Example |
|---|---|---|
| `wait.forPlaybackStart(timeout?)` | Wait until playing | `await m14u.wait.forPlaybackStart()` |
| `wait.forPlaybackPause(timeout?)` | Wait until paused | `await m14u.wait.forPlaybackPause()` |
| `wait.forRoute(path, timeout?)` | Wait for route | `await m14u.wait.forRoute('/search')` |
| `wait.forResults(timeout?)` | Wait for search results | `await m14u.wait.forResults()` |
| `wait.forQueueLength(n, timeout?)` | Wait for queue size | `await m14u.wait.forQueueLength(3)` |
| `wait.forTime(seconds, timeout?)` | Wait for playback time | `await m14u.wait.forTime(10)` |
| `wait.forBuffering(timeout?)` | Wait for buffering done | `await m14u.wait.forBuffering()` |
| `wait.forSong(title, timeout?)` | Wait for song by title | `await m14u.wait.forSong('Believer')` |
| `wait.for(pred, label, timeout?)` | Custom predicate | `await m14u.wait.for(() => true, 'custom')` |

## Assert
| Function | Description | Example |
|---|---|---|
| `assert.isPlaying(expected?)` | Assert play state | `m14u.assert.isPlaying()` |
| `assert.isPaused()` | Assert paused | `m14u.assert.isPaused()` |
| `assert.nowPlaying(title)` | Assert song title contains | `m14u.assert.nowPlaying('Believer')` |
| `assert.route(path)` | Assert current route | `m14u.assert.route('/search')` |
| `assert.queueLength(n)` | Assert queue length | `m14u.assert.queueLength(5)` |
| `assert.volume(v)` | Assert volume | `m14u.assert.volume(0.8)` |
| `assert.isFavorite(id, expected?)` | Assert favorite state | `m14u.assert.isFavorite('abc')` |
| `assert.hasResults()` | Assert search has results | `m14u.assert.hasResults()` |
| `assert.noError()` | Assert no playback error | `m14u.assert.noError()` |

## Logging
| Function | Description | Example |
|---|---|---|
| `log.enable()` | Enable structured logging | `m14u.log.enable()` |
| `log.disable()` | Disable logging | `m14u.log.disable()` |
| `log.get()` | Get all log entries | `m14u.log.get()` |
| `log.last(n?)` | Get last n entries | `m14u.log.last(5)` |
| `log.clear()` | Clear log | `m14u.log.clear()` |
| `log.errors()` | Get error entries only | `m14u.log.errors()` |

## Error
| Function | Description | Example |
|---|---|---|
| `lastError()` | Get last error entry | `m14u.lastError()` |
| `onError(callback)` | Register error listener | `m14u.onError(e => console.log(e))` |
| `clearErrors()` | Clear error state | `m14u.clearErrors()` |

## Highlight
| Function | Description | Example |
|---|---|---|
| `highlight(selector, label?)` | Highlight DOM element | `m14u.highlight('.player', 'Player')` |
| `highlightButton(text)` | Highlight button by text | `m14u.highlightButton('Play')` |
| `clearHighlights()` | Remove all highlights | `m14u.clearHighlights()` |

## State (Raw Debug)
| Function | Description | Example |
|---|---|---|
| `state.player()` | Raw player store state | `m14u.state.player()` |
| `state.ui()` | Raw UI store state | `m14u.state.ui()` |
| `state.search()` | Raw search store state | `m14u.state.search()` |
| `state.list()` | Raw list store state | `m14u.state.list()` |

## Content Loading
| Function | Description | Example |
|---|---|---|
| `load.album(id)` | Load album | `await m14u.load.album('abc')` |
| `load.artist(id)` | Load artist | `await m14u.load.artist('abc')` |
| `load.playlist(id, all?)` | Load playlist | `await m14u.load.playlist('abc')` |
| `load.channel(id)` | Load channel | `await m14u.load.channel('abc')` |

## Listen Along / Room
| Function | Description | Example |
|---|---|---|
| `room.create(name)` | Create a new room, returns tunnel URL | `await m14u.room.create('TestRoom')` |
| `room.join(displayName, roomName?)` | Join a room with display name | `await m14u.room.join('Alice', 'TestRoom')` |
| `room.leave()` | Leave current room | `m14u.room.leave()` |
| `room.listeners()` | Get connected listeners | `m14u.room.listeners()` |
| `room.state()` | Get full room state | `m14u.room.state()` |

## Meta
| Function | Description | Example |
|---|---|---|
| `help()` | Print all commands | `m14u.help()` |
| `version()` | API version | `m14u.version()` |
