// Reject common non-song listings even inside music collections.
export const nonSong = /\b(?:audio\s?books?|podcasts?|interviews?|radio\s+(?:show|program(?:me)?)|table of contents|sound effects?|field recordings?|pronunciations?|spoken word|lectures?|music theory|tutorials?|samples? pack)\b/i;
