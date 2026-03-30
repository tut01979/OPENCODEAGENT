import type { Tool } from './types.js';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

// ═══════════════════════════════════════════════════════════════
// Motor 1: DuckDuckGo HTML (extrae URLs reales)
// ═══════════════════════════════════════════════════════════════
async function searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResult[]> {
  const encodedQuery = encodeURIComponent(query);
  const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    },
  });

  const html = await response.text();
  const results: SearchResult[] = [];

  // Extraer bloques de resultado completos: título + URL + snippet
  const resultBlocks = html.split('class="result__body');

  for (let i = 1; i < resultBlocks.length && results.length < maxResults; i++) {
    const block = resultBlocks[i];

    // Extraer URL real (no DuckDuckGo redirect)
    let realUrl = '';
    const urlMatch = block.match(/class="result__url"[^>]*href="([^"]+)"/);
    if (urlMatch) {
      try {
        const ddgUrl = new URL(urlMatch[1]);
        realUrl = ddgUrl.searchParams.get('uddg') || urlMatch[1];
      } catch {
        realUrl = urlMatch[1];
      }
    }

    // Extraer título
    let title = '';
    const titleMatch = block.match(/class="result__a"[^>]*>([^<]+(?:<[^>]+>[^<]*)*)<\/a>/);
    if (titleMatch) {
      title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
    }

    // Extraer snippet
    let snippet = '';
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([^<]+(?:<[^>]+>[^<]*)*)/);
    if (snippetMatch) {
      snippet = snippetMatch[1].replace(/<[^>]+>/g, '').trim();
    }

    if (title && realUrl) {
      results.push({ title, url: realUrl, snippet: snippet || 'Sin descripción' });
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════
// Motor 2: DuckDuckGo News API (noticias en tiempo real)
// ═══════════════════════════════════════════════════════════════
async function searchNews(query: string, maxResults: number): Promise<SearchResult[]> {
  const encodedQuery = encodeURIComponent(query);
  const url = `https://lite.duckduckgo.com/lite/?q=${encodedQuery}+noticias&df=d&kl=es-es`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'es-ES,es;q=0.9',
    },
  });

  const html = await response.text();
  const results: SearchResult[] = [];

  // Extraer resultados de DDG Lite (más limpio para noticias)
  const links = html.match(/<a[^>]+class="result-link"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/g);
  const snippets = html.match(/<td[^>]*class="result-snippet"[^>]*>([^<]+)<\/td>/g);

  if (links) {
    for (let i = 0; i < Math.min(links.length, maxResults); i++) {
      const urlMatch = links[i].match(/href="([^"]+)"/);
      const titleMatch = links[i].match(/>([^<]+)<\/a>/);
      let snippet = '';

      if (snippets && snippets[i]) {
        const sMatch = snippets[i].match(/>([^<]+)</);
        snippet = sMatch ? sMatch[1].trim() : '';
      }

      if (urlMatch && titleMatch) {
        results.push({
          title: titleMatch[1].trim(),
          url: urlMatch[1],
          snippet: snippet || 'Sin descripción',
        });
      }
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════
// Motor 3: Google News RSS (noticias reales y actuales)
// ═══════════════════════════════════════════════════════════════
async function searchGoogleNews(query: string, maxResults: number): Promise<SearchResult[]> {
  const encodedQuery = encodeURIComponent(query);
  const url = `https://news.google.com/rss/search?q=${encodedQuery}&hl=es&gl=ES&ceid=ES:es`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)',
    },
  });

  const xml = await response.text();
  const results: SearchResult[] = [];

  // Parsear RSS XML básico
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

  for (let i = 0; i < Math.min(items.length, maxResults); i++) {
    const item = items[i];

    const titleMatch = item.match(/<title>[\s\S]*?(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
    const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/);
    const pubDateMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const sourceMatch = item.match(/<source[^>]*>([\s\S]*?)<\/source>/);

    const title = titleMatch ? titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
    const link = linkMatch ? linkMatch[1].trim() : '';
    const pubDate = pubDateMatch ? pubDateMatch[1].trim() : '';
    const source = sourceMatch ? sourceMatch[1].trim() : '';

    if (title && link) {
      const dateStr = pubDate ? new Date(pubDate).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
      results.push({
        title,
        url: link,
        snippet: source ? `${source} - ${dateStr}` : dateStr || 'Sin descripción',
      });
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════
// Herramienta principal
// ═══════════════════════════════════════════════════════════════
export const webSearchTool: Tool = {
  name: 'web_search',
  description: 'Busca información en la web. Incluye título, enlace directo y descripción de cada resultado. Para noticias recientes usa search_type="news".',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'La consulta de búsqueda. Para noticias agrega "noticias" o usa search_type="news".',
      },
      max_results: {
        type: 'number',
        description: 'Número máximo de resultados (default: 5)',
      },
      search_type: {
        type: 'string',
        description: 'Tipo de búsqueda: "web" (general) o "news" (noticias recientes con fecha y fuente). Default: "web"',
        enum: ['web', 'news'],
      },
    },
    required: ['query'],
  },
  execute: async (params, userId) => {
    const query = params.query as string;
    const maxResults = (params.max_results as number) || 5;
    const searchType = (params.search_type as string) || 'web';

    try {
      let results: SearchResult[] = [];

      if (searchType === 'news') {
        // Para noticias: intentar Google News RSS primero, luego DuckDuckGo News
        console.log(`📰 Buscando noticias: "${query}"`);
        results = await searchGoogleNews(query, maxResults);

        if (results.length === 0) {
          console.log('📰 Google News vacío, intentando DuckDuckGo News...');
          results = await searchNews(query, maxResults);
        }
      } else {
        // Para búsqueda general: DuckDuckGo
        console.log(`🔍 Buscando en web: "${query}"`);
        results = await searchDuckDuckGo(query, maxResults);
      }

      if (results.length === 0) {
        return `No se encontraron resultados para: "${query}"`;
      }

      // Formatear resultados con enlaces reales
      const formatted = results.map((r, i) => {
        return `**${i + 1}. ${r.title}**\n🔗 ${r.url}\n${r.snippet}`;
      }).join('\n\n');

      return `Resultados (${searchType === 'news' ? '📰 Noticias' : '🔍 Web'}) para "${query}":\n\n${formatted}`;

    } catch (error) {
      return `Error buscando en web: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};
