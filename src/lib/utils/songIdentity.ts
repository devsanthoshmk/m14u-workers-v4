export const normalizeSongText = (value: string) => value.normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();

export function songIdentity(title: string, author: string) {
    return `${normalizeSongText(title)}|${normalizeSongText(author.split(',')[0].replace(/\s+-\s+Topic$/i, ''))}`;
}
