import { YTNodes } from 'youtubei.js';
import { getClient } from './utils.js';

import type { ProviderBudget } from './providerBudget.js';

export default async function(budget: ProviderBudget, params: { q: string, music?: boolean }) {
  const { q, music } = params;
  const yt = await getClient(budget);

  if (music) {
    let suggestions;
    try {
      suggestions = await yt.music.getSearchSuggestions(q);
    } catch {
      budget.markDegraded();
      return [];
    }
    return suggestions.first()?.contents
      .map(s => (s.as(YTNodes.SearchSuggestion)).suggestion.toString()) || [];
  }

  try {
    return await yt.getSearchSuggestions(q);
  } catch {
    budget.markDegraded();
    return [];
  }
}
