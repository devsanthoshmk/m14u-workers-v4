import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import NodeCache from 'node-cache';
import YTMusic from 'ytmusic-api';
import { create } from 'youtube-dl-exec';
import path from 'path';
import { fileURLToPath } from 'url';
import webrtcRouter from './webrtc-signaling.js';
import v1RoomsRouter from './v1-rooms.js';

dotenv.config();

// Mute excessive ZodError logs from ytmusic-api 
const originalConsoleError = console.error;
console.error = (...args) => {
    if (typeof args[0] === 'string' && args[0].includes('ts-npm-ytmusic-api/issues')) {
        return;
    }
    originalConsoleError(...args);
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// We use relative path to avoid `tinyspawn` space splitting bug on absolute path with spaces
const ytbin = 'node_modules/youtube-dl-exec/bin/yt-dlp';
const ytExec = create(ytbin);

const ytmusic = new YTMusic();
ytmusic.initialize().catch(err => console.error("ytmusic init err:", err));

const app = express();
const port = process.env.PORT || 4000;
const cache = new NodeCache({ stdTTL: 3600, checkperiod: 120 }); // cache for 1 hour

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Mount original WebRTC routes (if still needed, else we can drop, let's keep or remove depending)
app.use('/api', webrtcRouter);
// Mount new v1 room polling routes
app.use('/api/v1/rooms', v1RoomsRouter);

// ─────────────────────────────────────────────────────────────────────────────
// Location & Language Resolver
// Maps friendly names like "tamil", "india", "usa" to proper ISO codes
// ─────────────────────────────────────────────────────────────────────────────

const LOCATION_MAP = {
    'india': 'IN', 'usa': 'US', 'us': 'US', 'uk': 'GB', 'britain': 'GB',
    'japan': 'JP', 'korea': 'KR', 'south korea': 'KR', 'germany': 'DE',
    'france': 'FR', 'brazil': 'BR', 'canada': 'CA', 'australia': 'AU',
    'spain': 'ES', 'mexico': 'MX', 'indonesia': 'ID', 'russia': 'RU',
    'italy': 'IT', 'turkey': 'TR', 'pakistan': 'PK', 'bangladesh': 'BD',
    'nigeria': 'NG', 'egypt': 'EG', 'sri lanka': 'LK', 'nepal': 'NP',
    'singapore': 'SG', 'malaysia': 'MY', 'thailand': 'TH', 'philippines': 'PH',
    'argentina': 'AR', 'colombia': 'CO', 'south africa': 'ZA', 'uae': 'AE',
    'saudi arabia': 'SA', 'vietnam': 'VN', 'china': 'CN', 'taiwan': 'TW',
};

const LANGUAGE_MAP = {
    'tamil': 'ta', 'hindi': 'hi', 'telugu': 'te', 'kannada': 'kn',
    'malayalam': 'ml', 'bengali': 'bn', 'marathi': 'mr', 'gujarati': 'gu',
    'punjabi': 'pa', 'urdu': 'ur', 'english': 'en', 'spanish': 'es',
    'french': 'fr', 'german': 'de', 'japanese': 'ja', 'korean': 'ko',
    'portuguese': 'pt', 'russian': 'ru', 'arabic': 'ar', 'chinese': 'zh',
    'italian': 'it', 'dutch': 'nl', 'turkish': 'tr', 'thai': 'th',
    'vietnamese': 'vi', 'indonesian': 'id', 'malay': 'ms', 'filipino': 'fil',
};

// Some languages strongly imply a country when used for trending
const LANGUAGE_TO_COUNTRY = {
    'ta': 'IN', 'hi': 'IN', 'te': 'IN', 'kn': 'IN', 'ml': 'IN',
    'bn': 'IN', 'mr': 'IN', 'gu': 'IN', 'pa': 'IN',
    'ja': 'JP', 'ko': 'KR', 'th': 'TH', 'vi': 'VN',
    'id': 'ID', 'ms': 'MY', 'fil': 'PH',
};

/**
 * Resolves a user-friendly query string into { gl, hl } ISO codes.
 * Accepts: raw ISO codes (IN, en), friendly names (india, tamil), or a combo (tamil india).
 */
function resolveLocale(queryStr) {
    if (!queryStr) return { gl: 'IN', hl: 'en' };

    const input = queryStr.toLowerCase().trim();
    let gl = null;
    let hl = null;

    // Try multi-word matches first (e.g. "south korea", "sri lanka", "saudi arabia")
    for (const [name, code] of Object.entries(LOCATION_MAP)) {
        if (name.includes(' ') && input.includes(name)) {
            gl = code;
            break;
        }
    }

    // Split remaining into single words
    const parts = input.split(/[\s,]+/);

    for (const part of parts) {
        // Check friendly location map (single-word entries)
        if (!gl && LOCATION_MAP[part]) {
            gl = LOCATION_MAP[part];
            continue;
        }
        // Check friendly language map
        if (!hl && LANGUAGE_MAP[part]) {
            hl = LANGUAGE_MAP[part];
            continue;
        }
        // Accept raw 2-letter codes directly (uppercase = country, lowercase = language)
        if (!gl && part.length === 2 && part === part.toUpperCase()) {
            gl = part;
        } else if (!hl && part.length === 2) {
            hl = part;
        }
    }

    // If language was set but not country, infer country from language
    if (hl && !gl && LANGUAGE_TO_COUNTRY[hl]) {
        gl = LANGUAGE_TO_COUNTRY[hl];
    }

    return { gl: gl || 'IN', hl: hl || 'en' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Enhance thumbnails for an item – appends 226, 544, 1080 sizes */
function enhanceThumbnails(item) {
    if (!item || !item.thumbnails || item.thumbnails.length === 0) return item;
    const baseThumbnailUrl = item.thumbnails[0].url.split('=')[0];
    const sizes = [226, 544, 1080];
    sizes.forEach(size => {
        if (!item.thumbnails.find(t => t.width === size)) {
            item.thumbnails.push({
                url: `${baseThumbnailUrl}=w${size}-h${size}-l90-rj`,
                width: size,
                height: size
            });
        }
    });
    item.thumbnails.sort((a, b) => a.width - b.width);
    return item;
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
    res.json({ message: "M14U Music API is running." });
});

// 1. Search endpoint
app.get('/api/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) {
            return res.status(400).json({ error: "Query parameter 'q' is required" });
        }

        const cacheKey = `search-${query}`;
        if (cache.has(cacheKey)) {
            return res.json(cache.get(cacheKey));
        }

        const results = await ytmusic.searchSongs(query);

        // Enhance results with larger thumbnails and a generated description for the UI
        const enhancedResults = results.map(song => {
            enhanceThumbnails(song);

            // Synthesize a description for rich metadata tags or UI content
            const artistName = song.artist?.name || "Unknown Artist";
            let description = `Listen to "${song.name}" by ${artistName}.`;
            if (song.album && song.album.name) {
                description += ` Featured on the album "${song.album.name}".`;
            }
            if (song.duration) {
                const minutes = Math.floor(song.duration / 60);
                const seconds = song.duration % 60;
                description += ` Duration: ${minutes}:${seconds < 10 ? '0' : ''}${seconds}.`;
            }
            song.description = description;

            // Stream hint so frontend doesn't need to construct URLs
            song.streamUrl = `/api/stream/${song.videoId}`;

            return song;
        });

        cache.set(cacheKey, enhancedResults);
        res.json(enhancedResults);
    } catch (error) {
        console.error("Search error:", error);
        res.status(500).json({ error: "Failed to search songs" });
    }
});

// 2. Trending / Home – location-aware
// Usage:
//   /api/trending?q=tamil           → gl=IN, hl=ta
//   /api/trending?q=india           → gl=IN, hl=en
//   /api/trending?q=tamil india     → gl=IN, hl=ta
//   /api/trending?q=usa             → gl=US, hl=en
//   /api/trending?q=korean          → gl=KR, hl=ko
//   /api/trending?gl=US&hl=en       → raw codes still work
app.get('/api/trending', async (req, res) => {
    try {
        // Support both raw codes (gl/hl) and friendly query (q)
        let gl, hl;
        if (req.query.q) {
            const resolved = resolveLocale(req.query.q);
            gl = resolved.gl;
            hl = resolved.hl;
        } else {
            gl = req.query.gl || 'IN';
            hl = req.query.hl || 'en';
        }

        const cacheKey = `trending-home-${gl}-${hl}`;
        if (cache.has(cacheKey)) {
            return res.json({ locale: { gl, hl }, sections: cache.get(cacheKey) });
        }

        // Initialize a ytmusic instance scoped to this locale
        const localYtMusic = new YTMusic();
        await localYtMusic.initialize({ gl, hl });

        const homeSections = await localYtMusic.getHomeSections();

        // Enhance thumbnails + strip out null items (ytmusic-api ZodError edge case)
        const enhancedSections = homeSections.map(section => {
            if (section.contents && Array.isArray(section.contents)) {
                section.contents = section.contents
                    .filter(item => item != null)
                    .map(item => {
                        enhanceThumbnails(item);
                        if (item.videoId) {
                            item.streamUrl = `/api/stream/${item.videoId}`;
                        }
                        return item;
                    });
            }
            return section;
        });

        cache.set(cacheKey, enhancedSections, 1800); // 30 min cache per locale
        res.json({ locale: { gl, hl }, sections: enhancedSections });
    } catch (error) {
        console.error("Trending error:", error);
        res.status(500).json({ error: "Failed to fetch trending content" });
    }
});

// A Map to store in-flight ytExec promises to deduplicate parallel requests
const inFlightStreams = new Map();

// 3. Audio stream link from YouTube Video ID
app.get('/api/stream/:videoId', async (req, res) => {
    try {
        const videoId = req.params.videoId;
        if (!videoId) {
            return res.status(400).json({ error: "Video ID is required" });
        }

        const cacheKey = `stream-${videoId}`;
        if (cache.has(cacheKey)) {
            return res.json({ url: cache.get(cacheKey) });
        }

        const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;

        let streamPromise = inFlightStreams.get(videoId);
        if (!streamPromise) {
            streamPromise = ytExec(ytUrl, {
                dumpJson: true,
                format: 'bestaudio',
                noCheckCertificates: true,
                noWarnings: true,
                preferFreeFormats: true
            }).finally(() => {
                inFlightStreams.delete(videoId);
            });
            inFlightStreams.set(videoId, streamPromise);
        }

        const result = await streamPromise;

        if (result && result.url) {
            // cache audio url for 2 hours (Google Video links typically expire in ~6 hours)
            cache.set(cacheKey, result.url, 7200);
            res.json({ url: result.url });
        } else {
            res.status(404).json({ error: "Audio stream not found" });
        }
    } catch (error) {
        console.error("Stream fetch error:", error);
        res.status(500).json({ error: "Failed to fetch stream link" });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
