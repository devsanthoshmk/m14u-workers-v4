import getAlbum from './getAlbum.js';
import getArtist from './getArtist.js';
import getChannel from './getChannel.js';
import getGallery from './getGallery.js';
import getPlaylist from './getPlaylist.js';
import getSearch from './getSearch.js';
import getSearchSuggestions from './getSearchSuggestions.js';
import getSimilar from './getSimilar.js';
import getSubFeed from './getSubFeed.js';
import { ProviderBudget, ProviderTimeout } from './providerBudget.js';
import { searchArchive, suggestArchive } from './archiveCatalog.js';
import { featuredOpen, resolveOpen, searchOpen, suggestOpen } from './openCatalog.js';
import type { Request } from '@cloudflare/workers-types';

export interface Env {
  LASTFM_API_KEY?: string;
  MUSIC_CATALOG?: string;
}

class InvalidCatalogRequest extends Error {}
class TrackNotFound extends Error {}

export default {
  async fetch(
    request: Pick<Request, 'url' | 'method'>,
    env?: Env
  ): Promise<Response> {
    const url = new URL(request.url);
    // The catalog is public and shared by the web app and packaged WebView.
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    const path = url.pathname.replace(/^\/api\//, '').replace(/^\//, '');
    const searchParams = url.searchParams;
    const budget = new ProviderBudget();

    try {
      let data: unknown;
      const catalog = searchParams.get('catalog') === 'youtube' ? 'youtube' : env?.MUSIC_CATALOG;
      const archiveSearch = catalog === 'archive' || catalog === 'open';
      const federatedSearch = catalog === 'open';

      switch (path) {
        case 'album': {
          const id = searchParams.get('id');
          if (!id) throw new InvalidCatalogRequest('Missing id parameter');
          data = await getAlbum(budget, id);
          break;
        }
        case 'artist': {
          const id = searchParams.get('id');
          if (!id) throw new InvalidCatalogRequest('Missing id parameter');
          data = await getArtist(budget, id);
          break;
        }
        case 'channel': {
          const id = searchParams.get('id');
          if (!id) throw new InvalidCatalogRequest('Missing id parameter');
          data = await getChannel(budget, id);
          break;
        }
        case 'gallery': {
          const id = searchParams.get('id');
          if (!id) throw new InvalidCatalogRequest('Missing id parameter');
          data = await getGallery(budget, id.split(','));
          break;
        }
        case 'playlist': {
          const id = searchParams.get('id');
          const all = searchParams.get('all') === 'true';
          if (!id) throw new InvalidCatalogRequest('Missing id parameter');
          data = await getPlaylist(budget, id, all);
          break;
        }
        case 'search': {
          const q = searchParams.get('q');
          const f = searchParams.get('f');
          if (!q?.trim()) throw new InvalidCatalogRequest('Missing q parameter');
          if (archiveSearch && q.length > 160) throw new InvalidCatalogRequest('Query too long');
          data = archiveSearch && (!f || f === 'all' || f === 'song')
            ? await (federatedSearch ? searchOpen : searchArchive)(budget, q.trim())
            : await getSearch(budget, { q, f: f || undefined });
          break;
        }
        case 'search-suggestions': {
          const q = searchParams.get('q');
          const music = searchParams.get('music') === 'true';
          if (!q?.trim()) throw new InvalidCatalogRequest('Missing q parameter');
          if (archiveSearch && q.length > 160) throw new InvalidCatalogRequest('Query too long');
          data = archiveSearch ? await (federatedSearch ? suggestOpen : suggestArchive)(budget, q.trim()) : await getSearchSuggestions(budget, { q, music });
          break;
        }
        case 'search-discovery': {
          data = { openCatalog: archiveSearch, tracks: federatedSearch ? await featuredOpen(budget) : [] };
          break;
        }
        case 'stream': {
          const id = searchParams.get('id');
          if (!id) throw new InvalidCatalogRequest('Missing id parameter');
          data = await resolveOpen(budget, id);
          if (!data) throw new TrackNotFound();
          break;
        }
        case 'similar': {
          const title = searchParams.get('title');
          const artist = searchParams.get('artist');
          const limit = searchParams.get('limit');
          if (!title || !artist) throw new InvalidCatalogRequest('Missing title or artist parameter');
          data = await getSimilar(budget, { title, artist, limit: limit || undefined }, env?.LASTFM_API_KEY);
          break;
        }
        case 'subfeed': {
          const id = searchParams.get('id');
          if (!id) throw new InvalidCatalogRequest('Missing id parameter');
          data = await getSubFeed(budget, id.split(','));
          break;
        }
        default:
          return new Response(JSON.stringify({ error: 'Not Found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
      }

      budget.checkDeadline();
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          // Preserve fallback payloads without letting transient failures stick in cache.
          'Cache-Control': !budget.cacheable || path === 'stream' ? 'no-store'
            : path === 'search-discovery' || (archiveSearch && (path === 'search' || path === 'search-suggestions')) ? 'public, max-age=60, s-maxage=300'
            : 's-maxage=86400, stale-while-revalidate=3600'
        }
      });
    } catch (err) {
      const invalid = err instanceof InvalidCatalogRequest;
      const timeout = budget.expired || err instanceof ProviderTimeout ||
        (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError'));
      const absent = err instanceof TrackNotFound;
      const status = invalid ? 400 : absent ? 404 : timeout ? 504 : 500;
      const message = invalid ? err.message : absent ? 'Track unavailable' : timeout ? 'Catalog provider timed out' : 'Catalog operation failed';
      if (!invalid && !absent) console.error({ event: 'catalog_request_failed', route: path, status });
      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }
  }
};
