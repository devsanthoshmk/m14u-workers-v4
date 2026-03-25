import { YTNodes } from 'youtubei.js';
import { getClient } from './utils.js';

export default async function(params: { q: string, music?: boolean }) {
  const { q, music } = params;
  const yt = await getClient();

  if (music) {
    let suggestions;
    try {
      suggestions = await yt.music.getSearchSuggestions(q);
    } catch {
      return [];
    }
    return suggestions.first()?.contents
      .map(s => (s.as(YTNodes.SearchSuggestion)).suggestion.toString()) || [];
  }

  try {
    return await yt.getSearchSuggestions(q);
  } catch {
    return [];
  }
}
