const codes: Record<string, string> = {
    en: 'english', ta: 'tamil', hi: 'hindi', te: 'telugu', kn: 'kannada', ml: 'malayalam',
    bn: 'bengali', mr: 'marathi', pa: 'punjabi', ko: 'korean', ja: 'japanese', es: 'spanish',
    fr: 'french', de: 'german', ar: 'arabic', pt: 'portuguese',
};

export function normalizeMusicLanguage(value: unknown): string {
    if (typeof value !== 'string') return '';
    const label = value.trim().toLowerCase();
    const code = label.split(/[-_]/)[0];
    return Object.hasOwn(codes, code) ? codes[code] : Object.values(codes).includes(label) ? label : '';
}

export function normalizeMusicLanguages(values: unknown): string[] {
    if (!values) return [];
    const list: string[] = [];
    if (typeof values === 'string') {
        const parts = values.includes(',') ? values.split(',') : [values];
        for (const p of parts) list.push(p);
    } else if (Array.isArray(values)) {
        for (const item of values) {
            if (typeof item === 'string') {
                const parts = item.includes(',') ? item.split(',') : [item];
                for (const p of parts) list.push(p);
            }
        }
    }
    const result: string[] = [];
    for (const item of list) {
        const normalized = normalizeMusicLanguage(item);
        if (normalized && !result.includes(normalized)) {
            result.push(normalized);
        }
    }
    return result;
}

type Result = { type?: string; language?: string; title?: string; name?: string };
const titleKey = (value: string) => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');

export function rankSongsByLanguage<T extends Result>(
    results: T[],
    languageOrLanguages: string | readonly string[] | string[],
    query = ''
): T[] {
    const preferredList = normalizeMusicLanguages(languageOrLanguages);
    if (preferredList.length === 0) return results;
    const preferredSet = new Set(preferredList);
    const exactQuery = titleKey(query);
    const output = [...results];

    // Equal bounded ranking: boost matching preferred songs equally within 4-item relevance bands,
    // without moving non-song rows or exact matches, and preserving relative order among matching songs.
    for (let i = 0; i < results.length; i += 4) {
        const slots: number[] = [];
        const matching: T[] = [];
        const rest: T[] = [];
        for (let j = i; j < Math.min(i + 4, results.length); j++) {
            const result = results[j];
            if (result.type && result.type.toLowerCase() !== 'song') continue;
            if (exactQuery && titleKey(result.title || result.name || '') === exactQuery) continue;
            slots.push(j);
            const songLang = normalizeMusicLanguage(result.language);
            (preferredSet.has(songLang) ? matching : rest).push(result);
        }
        [...matching, ...rest].forEach((result, index) => { output[slots[index]] = result; });
    }
    return output;
}
