import { YTNodes } from 'youtubei.js';
import { getClient, formatDuration, parsePublished } from './utils.js';
import { MAX_BATCH_IDS, type ProviderBudget } from './providerBudget.js';

export default async function(budget: ProviderBudget, ids: string[]) {
  const yt = await getClient(budget);

  const results = await budget.map(ids.slice(0, MAX_BATCH_IDS), id =>
    yt.getChannel(id)
      .then(channel => channel.getVideos().then(v => ({
        author: channel.metadata.title?.toString() || '',
        authorId: id,
        videos: v.videos
      })))
      .catch(() => {
        budget.markDegraded();
        return { author: '', authorId: id, videos: [] };
      })
  );

  const allVideos = results.flatMap(r =>
    r.videos.flatMap(v => {
      if (v.is(YTNodes.Video)) {
        const video = v.as(YTNodes.Video);
        if ((video.duration?.seconds || 0) > 90 && (video.short_view_count?.toString() || video.view_count?.toString())) {
          return [{
            video,
            authorName: r.author,
            authorId: r.authorId
          }];
        }
      }
      return [];
    })
  );

  return allVideos
    .sort((a, b) => {
      const timeA = a.video.published?.toString() ? parsePublished(a.video.published.toString()) : 0;
      const timeB = b.video.published?.toString() ? parsePublished(b.video.published.toString()) : 0;
      return timeB - timeA;
    })
    .map(({ video, authorName, authorId }) => {
      const views = video.short_view_count?.toString() || video.view_count?.toString();
      const published = video.published?.toString()?.replace('Streamed ', '');
      const subtext = (views || '') + (published ? ' • ' + published : '');

      return {
        id: video.id,
        title: video.title?.toString() || '',
        author: authorName || video.author.name?.toString() || '',
        authorId: authorId || video.author.id || '',
        duration: formatDuration(video.duration?.text?.toString()),
        subtext,
        type: 'video' as const
      };
    });
}
