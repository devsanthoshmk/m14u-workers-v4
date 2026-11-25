import search from '../../upstream/songs.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).end();

    const q = typeof req.query.query === 'string' ? req.query.query.trim() : '';
    const n = Number(req.query.limit ?? 20);
    if (!q || q.length > 300 || !Number.isInteger(n) || n < 1 || n > 100) {
        return res.status(400).json({ success: false, message: 'Invalid search parameters' });
    }

    // Only the selected upstream handler is exposed; the rest of upstream is not deployed.
    let status;
    let payload;
    try {
        await search({ method: 'GET', query: { q, n: String(n) } }, {
            setHeader() {},
            status(code) { status = code; return this; },
            json(body) { payload = body; },
        });
        if (status !== 200 || !Array.isArray(payload?.results)) throw new Error('Invalid upstream search response');
        const results = payload.results.slice(0, n).map(song => ({
            id: song.id,
            name: song.title,
            duration: song.more_info?.duration,
            language: song.language,
            url: song.perma_url,
            image: typeof song.image === 'string' ? [{ url: song.image }] : [],
            artists: { primary: song.more_info?.artists?.primary },
            album: { name: song.more_info?.album },
        }));
        return res.status(200).json({ success: true, data: { results } });
    } catch {
        return res.status(502).json({ success: false, message: 'JioSaavn search unavailable' });
    }
}
