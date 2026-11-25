import { YTNodes } from 'youtubei.js';
import { getClient } from './utils.js';
import type { ProviderBudget } from './providerBudget.js';

export default async function getUpNext(budget: ProviderBudget, id: string) {
  const yt = await getClient(budget);
  const panel = await yt.music.getUpNext(id);
  const seen = new Set([id]);
  return panel.contents.flatMap(node => {
    if (!node.is(YTNodes.PlaylistPanelVideo)) return [];
    const video = node.as(YTNodes.PlaylistPanelVideo);
    const title = video.title.toString();
    const author = video.artists?.map(artist => artist.name).join(', ') || video.author;
    if (!video.video_id || !title || !author || seen.has(video.video_id)) return [];
    seen.add(video.video_id);
    return [{ id: video.video_id, title, author }];
  }).slice(0, 12);
}
