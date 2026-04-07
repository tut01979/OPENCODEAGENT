import type { Tool } from './types.js';
import { SEP } from '../utils/sanitize.js';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: string;
  date?: string;
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
// Motor 2: Búsqueda Local (negocios, empresas, clínicas, etc.)
// ═══════════════════════════════════════════════════════════════
async function searchLocal(query: string, maxResults: number): Promise<SearchResult[]> {
  // Extraer ciudad de la query para verificar relevancia
  const cityMatch = query.match(/en\s+([A-Za-záéíóúñÁÉÍÓÚÑ\s]+)|cerca\s+de\s+([A-Za-záéíóúñÁÉÍÓÚÑ\s]+)|([A-Za-záéíóúñÁÉÍÓÚÑ]+)\s*$/i);
  const targetCity = cityMatch ? (cityMatch[1] || cityMatch[2] || cityMatch[3]).trim().toLowerCase() : null;

  // Términos de búsqueda más específicos para negocios
  const searchQuery = `${query} dirección teléfono contacto`;
  const encodedQuery = encodeURIComponent(searchQuery);
  const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}&kl=es-es`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      'Accept': 'text/html,application/xhtml+xml',
    },
  });

  const html = await response.text();
  const rawResults: SearchResult[] = [];

  const resultBlocks = html.split('class="result__body');

  for (let i = 1; i < resultBlocks.length && rawResults.length < maxResults * 3; i++) {
    const block = resultBlocks[i];

    // Extraer URL real
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
      rawResults.push({ title, url: realUrl, snippet: snippet || '' });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // FILTROS ESTRICTOS DE CALIDAD
  // ═══════════════════════════════════════════════════════════════
  const verifiedResults: SearchResult[] = [];

  // Dominios confiables para negocios locales
  const trustedDomains = [
    'google.com/maps',
    'maps.google',
    'g.page',
    'facebook.com',
    'instagram.com',
    'linkedin.com',
    'yelp.com',
    'tripadvisor.com',
    'foursquare.com',
    'paginasamarillas.es',
    'qdq.com',
    '11870.com',
    'infobel.com',
    'hotels.com',
    'booking.com',
    'idealista.com',
    'fotocasa.es',
  ];

  // Indicadores de datos de contacto reales
  const contactIndicators = [
    /\b\d{3}[\s-]?\d{3}[\s-]?\d{3}\b/,  // Teléfonos españoles
    /\b\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/,
    /\b\d{4}[\s-]?\d{2}[\s-]?\d{2}[\s-]?\d{2}\b/,
    /\+34[\s-]?\d/,
    /tel[eé]fono/i,
    /m[oó]vil/i,
    /contacto/i,
    /direcci[oó]n/i,
    /calle/i,
    /avenida/i,
    /plaza/i,
    /paseo/i,
    /\b\d{5}\b/,  // Códigos postales españoles
    /www\./i,
    /\.es\b/i,
    /\.com\b/i,
  ];

  for (const result of rawResults) {
    const urlLower = result.url.toLowerCase();
    const snippetLower = result.snippet.toLowerCase();
    const titleLower = result.title.toLowerCase();

    // EXCLUIR Directorios genéricos que no dan info directa del negocio (evita alucinación)
    const isGenericDirectory = (urlLower.includes('paginasamarillas.es') && !urlLower.includes('/ficha/')) ||
                               (urlLower.includes('qdq.com') && !urlLower.includes('/perfil/')) ||
                               urlLower.includes('yelp.es/search') ||
                               urlLower.includes('tripadvisor.es/Search');

    // Verificar que es un dominio confiable O tiene datos de contacto
    const isTrustedDomain = trustedDomains.some(domain => urlLower.includes(domain));
    const hasContactData = contactIndicators.some(pattern => pattern.test(snippetLower));
    const hasRealBusinessName = titleLower.length > 3 && !titleLower.includes('pdf') && !titleLower.includes('doc');

    // Verificar que la ciudad coincide si se especificó
    const cityInResult = targetCity && (
      snippetLower.includes(targetCity) ||
      titleLower.includes(targetCity) ||
      urlLower.includes(targetCity.replace(/\s+/g, '-'))
    );

    // Solo aceptar si cumple criterios estrictos
    if ((isTrustedDomain || (hasContactData && hasRealBusinessName)) && !isGenericDirectory) {
      // Si se especificó ciudad, verificar que esté presente
      if (targetCity && !cityInResult && !isTrustedDomain) {
        continue; // Saltar resultados de otras ciudades
      }

      // Extraer datos explícitos si están en el snippet
      const phoneMatch = result.snippet.match(/\b\d{9}\b|\+34\s?\d{9}/);
      const phone = phoneMatch ? `📞 **Teléfono:** ${phoneMatch[0]}` : '';

      // Limpiar y formatear el snippet
      const cleanSnippet = result.snippet
        .replace(/\.\.\./g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200);

      verifiedResults.push({
        title: result.title,
        url: result.url,
        snippet: `${cleanSnippet}${phone ? `\n${phone}` : ''}`,
        source: isTrustedDomain ? '✅ Verificado' : '📍 Local',
      });
    }
  }

  // Si no hay suficientes resultados verificados, intentar con Google Maps
  if (verifiedResults.length < maxResults) {
    const mapsResults = await searchGoogleMaps(query, maxResults - verifiedResults.length);
    verifiedResults.push(...mapsResults);
  }

  return verifiedResults.slice(0, maxResults);
}

// ═══════════════════════════════════════════════════════════════
// Motor alternativo: Google Maps (para resultados verificados)
// ═══════════════════════════════════════════════════════════════
async function searchGoogleMaps(query: string, maxResults: number): Promise<SearchResult[]> {
  const encodedQuery = encodeURIComponent(query);
  const url = `https://www.google.com/search?q=${encodedQuery}&hl=es&gl=ES`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'es-ES,es;q=0.9',
      },
    });

    const html = await response.text();
    const results: SearchResult[] = [];

    // Buscar bloques de Google Maps en resultados
    const mapBlocks = html.match(/<div[^>]*data-lat[^>]*>[\s\S]*?<\/div>/g) || [];
    const businessBlocks = html.match(/<div[^>]*class="[^"]*rlflab[^"]*"[^>]*>[\s\S]*?<\/div>/g) || [];

    // Extraer datos de negocio si existen
    for (let i = 0; i < Math.min(businessBlocks.length, maxResults); i++) {
      const block = businessBlocks[i];

      const titleMatch = block.match(/<span[^>]*role="heading"[^>]*>([^<]+)<\/span>/) ||
                         block.match(/<div[^>]*class="[^"]*dbg0pd[^"]*"[^>]*>([^<]+)<\/div>/);

      if (titleMatch) {
        const title = titleMatch[1].trim();
        // Crear enlace a Google Maps para ese negocio
        const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(title)}`;

        results.push({
          title,
          url: mapsUrl,
          snippet: 'Ver en Google Maps para dirección y teléfono',
          source: '📍 Maps',
        });
      }
    }

    return results;
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// Motor 3: DuckDuckGo News API (noticias en tiempo real)
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
// Motor 4: Google News RSS (noticias reales y actuales)
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
        source,
        date: dateStr,
      });
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════
// Motor 5: Brave Search API (Calidad Superior y Gratis/Pago)
// ═══════════════════════════════════════════════════════════════
async function searchBrave(query: string, maxResults: number): Promise<SearchResult[]> {
  const apiKey = (config as any).brave?.apiKey;
  if (!apiKey) return [];

  try {
    console.log(`🦁 Brave Search: Consultando "${query}"...`);
    const encodedQuery = encodeURIComponent(query);
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodedQuery}&count=${maxResults}&country=es&safesearch=off&spellcheck=1`;

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': apiKey,
      },
    });

    if (!response.ok) {
      console.warn(`⚠️ Brave Search falló: ${response.status} ${response.statusText}`);
      return [];
    }

    const data: any = await response.json();
    const results: SearchResult[] = [];

    if (data.web?.results) {
      for (const r of data.web.results) {
        results.push({
          title: r.title,
          url: r.url,
          snippet: r.description || 'Sin descripción',
          source: '🦁 Brave',
        });
      }
    }

    // Si es búsqueda local, intentar extraer info de local_results si existe
    if (data.locations?.results) {
      for (const loc of data.locations.results) {
        results.unshift({
          title: loc.title,
          url: `https://www.google.com/maps/search/${encodeURIComponent(loc.title)}`,
          snippet: `${loc.address || ''} ${loc.phone ? `📞 ${loc.phone}` : ''}`.trim(),
          source: '📍 Brave Local',
        });
      }
    }

    return results;
  } catch (err) {
    console.error('❌ Error en Brave Search:', err);
    return [];
  }
}

import { config } from '../config.js';

// ═══════════════════════════════════════════════════════════════
// Herramienta principal
// ═══════════════════════════════════════════════════════════════
export const webSearchTool: Tool = {
  name: 'web_search',
  description: `Busca información en la web con resultados completos. Tipos disponibles:
- "web": Búsqueda general con títulos claros, enlaces directos y resúmenes útiles (Usa Brave + DuckDuckGo).
- "news": Noticias recientes con fecha, fuente y enlace.
- "local": Negocios, empresas, clínicas, restaurantes. Incluye dirección, teléfono y web cuando está disponible.`,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'La consulta de búsqueda. Para negocios locales usa: "clínicas dentales en Valencia", "restaurantes cerca de mí", etc.',
      },
      max_results: {
        type: 'number',
        description: 'Número máximo de resultados (default: 5)',
      },
      search_type: {
        type: 'string',
        description: 'Tipo de búsqueda: "web" (general), "news" (noticias recientes) o "local" (negocios/empresas). Default: "web"',
        enum: ['web', 'news', 'local'],
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
      } else if (searchType === 'local') {
        // Para negocios locales: Brave Search (si está disponible) -> searchLocal (Scraper)
        console.log(`📍 Buscando locales: "${query}"`);
        results = await searchBrave(query, maxResults);
        
        if (results.length < maxResults) {
          const localResults = await searchLocal(query, maxResults - results.length);
          results.push(...localResults);
        }
      } else {
        // Para búsqueda general: Brave Search -> DuckDuckGo
        console.log(`🔍 Buscando en web: "${query}"`);
        results = await searchBrave(query, maxResults);

        if (results.length < maxResults) {
          const ddgResults = await searchDuckDuckGo(query, maxResults - results.length);
          results.push(...ddgResults);
        }
      }

      const manualLinks = `
🚀 **Aumenta tus posibilidades de búsqueda:**
📍 Google Maps: https://www.google.com/maps/search/${encodeURIComponent(query)}
📒 Páginas Amarillas: https://www.paginasamarillas.es/resultados.html?what=${encodeURIComponent(query)}`;

      if (results.length === 0) {
        if (searchType === 'local') {
          return `📍 **No encontré resultados verificados para: "${query}"**

⚠️ Esto puede deberse a que la información no es pública o la ubicación es poco específica.

💡 **Prueba con estos enlaces directos:**${manualLinks}`;
        }
        return `No se encontraron resultados para: "${query}"`;
      }

      // Formatear resultados con estructura clara
      let formatted: string;

      if (searchType === 'news') {
        formatted = results.map((r, i) => {
          return `📰 **${i + 1}. ${r.title}**\n📅 ${r.date || 'Fecha desconocida'}\n📰 ${r.source || 'Fuente desconocida'}\n🔗 ${r.url}\n📝 ${r.snippet}`;
        }).join('\n\n');
      } else if (searchType === 'local') {
        formatted = results.map((r, i) => {
          const verified = r.source?.includes('Verificado') ? '✅' : '📍';
          return `${verified} **${i + 1}. ${r.title}**\n🔗 ${r.url}\n📝 ${r.snippet}`;
        }).join('\n\n');

        // ✅ Añadir enlaces de soporte al final para aumentar posibilidades (SOLICITADO POR USUARIO)
        formatted += `\n\n${SEP}${manualLinks}`;
      } else {
        formatted = results.map((r, i) => {
          return `🔍 **${i + 1}. ${r.title}**\n🔗 ${r.url}\n📝 ${r.snippet}`;
        }).join('\n\n');
      }

      const typeEmoji = searchType === 'news' ? '📰 Noticias' : searchType === 'local' ? '📍 Locales' : '🔍 Web';
      const disclaimer = `\n\n---\n_⚠️ Datos extraídos en tiempo real. Si un dato no aparece, es que no ha sido encontrado por el buscador. NUNCA lo supongas._\n_Total: ${results.length} resultados_`;

      return `**${typeEmoji} para "${query}":**\n\n${formatted}${disclaimer}`;

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return `❌ **Error en la búsqueda web:** ${errorMsg}

💡 **No te preocupes, puedes buscar manualmente aquí:**
📍 Google Maps: https://www.google.com/maps/search/${encodeURIComponent(query)}
📒 Páginas Amarillas: https://www.paginasamarillas.es/resultados.html?what=${encodeURIComponent(query)}`;
    }
  },
};
