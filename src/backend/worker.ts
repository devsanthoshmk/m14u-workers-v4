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
import type { Request } from '@cloudflare/workers-types';

export interface Env {
  LASTFM_API_KEY?: string;
}

class InvalidCatalogRequest extends Error {}

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
          if (!q) throw new InvalidCatalogRequest('Missing q parameter');
          data = await getSearch(budget, { q, f: f || undefined });
          break;
        }
        case 'search-suggestions': {
          const q = searchParams.get('q');
          const music = searchParams.get('music') === 'true';
          if (!q) throw new InvalidCatalogRequest('Missing q parameter');
          data = await getSearchSuggestions(budget, { q, music });
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
          'Cache-Control': budget.cacheable ? 's-maxage=86400, stale-while-revalidate=3600' : 'no-store'
        }
      });
    } catch (err) {
      const invalid = err instanceof InvalidCatalogRequest;
      const timeout = budget.expired || err instanceof ProviderTimeout ||
        (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError'));
      const status = invalid ? 400 : timeout ? 504 : 500;
      const message = invalid ? err.message : timeout ? 'Catalog provider timed out' : 'Catalog operation failed';
      if (!invalid) console.error({ event: 'catalog_request_failed', route: path, status });
      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }
  }
};
