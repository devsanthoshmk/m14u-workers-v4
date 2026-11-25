export const normalizeSongText = (value: string) => value.normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();

export function canonicalSongTitle(title: string) {
    // Soundtrack singles often add a quoted film credit that the album release omits.
    return normalizeSongText(title.normalize('NFKC').replace(/\s*[[(]\s*from\s+["“‘'][^\])]+["”’']\s*[\])]\s*$/iu, ''));
}

export function songIdentityKeys(title: string, author: string) {
    const name = canonicalSongTitle(title);
    const artists = author.split(',').map(artist => normalizeSongText(artist.replace(/\s+-\s+Topic$/i, ''))).filter(Boolean);
    return [...new Set(artists.length ? artists : [''])].map(artist => `${name}|${artist}`);
}
