import type { Tool } from './types.js';

export const webSearchTool: Tool = {
  name: 'web_search',
  description: 'Busca información en la web usando DuckDuckGo',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'La consulta de búsqueda',
      },
      max_results: {
        type: 'number',
        description: 'Número máximo de resultados (default: 5)',
      },
    },
    required: ['query'],
  },
  execute: async (params) => {
    const query = params.query as string;
    const maxResults = (params.max_results as number) || 5;

    try {
      const encodedQuery = encodeURIComponent(query);
      const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });
      
      const html = await response.text();
      
      // Extraer resultados básicos del HTML
      const results: string[] = [];
      const snippets = html.match(/class="result__snippet"[^>]*>([^<]+)</g);
      
      if (snippets) {
        for (let i = 0; i < Math.min(snippets.length, maxResults); i++) {
          const text = snippets[i].replace(/class="result__snippet"[^>]*>/, '').trim();
          results.push(`${i + 1}. ${text}`);
        }
      }

      if (results.length === 0) {
        return `No se encontraron resultados para: "${query}"`;
      }

      return `Resultados de búsqueda para "${query}":\n\n${results.join('\n\n')}`;
    } catch (error) {
      return `Error buscando en web: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};
