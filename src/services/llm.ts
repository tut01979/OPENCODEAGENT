import { config } from '../config.js';
import type { Message, ToolCall } from '../tools/types.js';

interface LLMResponse {
  content: string | null;
  toolCalls?: ToolCall[];
}

interface APIChoice {
  message: {
    content: string | null;
    tool_calls?: Array<{
      id: string;
      type: string;
      function: {
        name: string;
        arguments: string;
      };
    }>;
  };
}

interface APIResponse {
  choices: APIChoice[];
}

const OPENROUTER_FALLBACK_MODELS = [
  'openai/gpt-4o-mini',
  'google/gemini-2.0-flash-lite-preview-02-05',
  'anthropic/claude-3-haiku',
  'mistralai/mistral-small-24b-instruct-2501',
  'google/gemini-flash-1.5',
];

async function callOllama(messages: Message[], tools?: unknown[]): Promise<LLMResponse> {
  if (!config.ollama.baseUrl) throw new Error('Ollama not configured');
  
  const ollamaMessages = messages.map(m => ({
    role: m.role,
    content: m.content || '',
  }));

  const response = await fetch(`${config.ollama.baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ollama.model,
      messages: ollamaMessages,
      stream: false,
      options: { temperature: 0.3 },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status}`);
  }

  const data = await response.json();
  return { content: data.message?.content || null, toolCalls: undefined };
}

async function callGroq(messages: Message[], tools?: unknown[]): Promise<LLMResponse> {
  if (!config.groq.apiKey) throw new Error('Groq API key not configured');
  
  const hasImages = messages.some(m => {
    if (Array.isArray(m.content)) {
      return (m.content as any[]).some((c: any) => c.type === 'image_url');
    }
    return false;
  });
  
  if (hasImages) throw new Error('Groq no soporta imágenes.');
  
  const model = config.groq.model;
  console.log(`🤖 Groq (Text): ${model}`);

  const cleanedMessages = messages.map(m => {
    if (Array.isArray(m.content)) {
      const textParts = (m.content as any[])
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text);
      return { ...m, content: textParts.join('\n') || '[Contenido multimodal]' };
    }
    return m;
  });

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.groq.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: cleanedMessages,
      tools: tools?.length ? tools : undefined,
      tool_choice: tools?.length ? 'auto' : undefined,
      max_tokens: 4096,
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorData;
    try { errorData = JSON.parse(errorText); } catch { errorData = { error: { message: errorText } }; }

    if (errorData.error?.code === 'tool_use_failed' && tools?.length) {
      console.warn('⚠️ Groq tool_use_failed. Reintentando sin herramientas...');
      return await callGroq(messages, undefined);
    }

    const status = response.status;
    throw { status, message: errorText };
  }

  const data: APIResponse = await response.json();
  return parseResponse(data);
}

async function callOpenRouter(messages: Message[], tools?: unknown[], forceModel?: string): Promise<LLMResponse> {
  if (!config.openrouter.apiKey) throw new Error('OpenRouter API key not configured');

  const model = forceModel || config.openrouter.model;
  console.log(`📡 OpenRouter [${model}]`);

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.openrouter.apiKey}`,
      'HTTP-Referer': 'https://opencodeagent.local',
      'X-Title': 'OpenCodeAgent',
    },
    body: JSON.stringify({
      model,
      messages,
      tools: tools?.length ? tools : undefined,
      tool_choice: tools?.length ? 'auto' : undefined,
      max_tokens: 4096,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    const status = response.status;
    throw { status, message: error };
  }

  const data: APIResponse = await response.json();
  return parseResponse(data);
}

function cleanResponse(text: string | null): string | null {
  if (!text) return null;
  let cleaned = text;
  cleaned = cleaned.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '');
  cleaned = cleaned.replace(/\[system-reminder\][\s\S]*?\[\/system-reminder\]/gi, '');
  cleaned = cleaned.replace(/Your operational mode[\s\S]*?tools as needed\./gi, '');
  cleaned = cleaned.replace(/Operational mode[\s\S]*?changed[\s\S]*?\./gi, '');
  cleaned = cleaned.replace(/You are no longer[\s\S]*?\./gi, '');
  cleaned = cleaned.replace(/You are permitted[\s\S]*?tools[\s\S]*?\./gi, '');
  cleaned = cleaned.replace(/<\|assistant\|>[\s\S]*?<\|\/assistant\|>/gi, '');
  cleaned = cleaned.replace(/\[INST\][\s\S]*?\[\/INST\]/gi, '');
  cleaned = cleaned.replace(/<<SYS>>[\s\S]*?<\/SYS>>/gi, '');
  cleaned = cleaned.replace(/#{3,}/g, '###'); 
  cleaned = cleaned.replace(/(\*\*\s*){2,}/g, '**'); 
  cleaned = cleaned.replace(/(\n\s*){3,}/g, '\n\n'); 
  cleaned = cleaned.replace(/[\u2500-\u257F\u2580-\u259F]/g, ''); 
  cleaned = cleaned.replace(/^\s*\n/gm, '').trim();
  return cleaned || null;
}

function parseResponse(data: APIResponse): LLMResponse {
  const choice = data.choices[0];
  if (!choice) throw new Error('No response choices from API');
  const message = choice.message;
  const content = cleanResponse(message.content);
  
  let toolCalls: ToolCall[] | undefined;
  if (message.tool_calls && message.tool_calls.length > 0) {
    try {
      toolCalls = message.tool_calls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      }));
    } catch (e) {
      console.error('Error parsing tool calls:', e);
      toolCalls = undefined;
    }
  }

  return { content, toolCalls: toolCalls?.length ? toolCalls : undefined };
}

export async function chat(messages: Message[], tools?: unknown[]): Promise<LLMResponse> {
  const hasImages = messages.some(m => {
    if (Array.isArray(m.content)) {
      return (m.content as any[]).some((c: any) => c.type === 'image_url');
    }
    return false;
  });

  // 1. SI HAY IMÁGENES: OpenRouter (Gemini) es obligatorio
  if (hasImages && config.openrouter.apiKey) {
    try {
      console.log(`🎨 [VISIÓN] Usando OpenRouter (Gemini 2.0)...`);
      return await callOpenRouter(messages, tools, config.openrouter.model);
    } catch (err) {
      console.error('Error en visión OpenRouter:', err);
      // Fallback a otros modelos de OpenRouter que soporten visión si Gemini falla
      for (const model of OPENROUTER_FALLBACK_MODELS) {
        if (model.includes('gemini') || model.includes('gpt-4o')) {
          try { return await callOpenRouter(messages, tools, model); } catch { continue; }
        }
      }
    }
  }

  // 2. TEXTO - PRIORIDAD 1: Groq (Llama 3.3 70B) - El más rápido
  if (!hasImages && config.groq.apiKey) {
    try {
      console.log(`🚀 [TEXTO] Usando Groq (Llama 70B)...`);
      return await callGroq(messages, tools);
    } catch (err: any) {
      console.error(`Groq falló (Status ${err.status}):`, err.message);
      // Si es rate limit (429), pasar a OpenRouter
    }
  }

  // 3. TEXTO - PRIORIDAD 2: OpenRouter (gpt-4o-mini o fallbacks)
  if (config.openrouter.apiKey) {
    const textModels = [
      (config.openrouter as any).textModel || 'openai/gpt-4o-mini',
      ...OPENROUTER_FALLBACK_MODELS
    ];

    for (const model of textModels) {
      try {
        console.log(`🧠 [FALLBACK] Usando OpenRouter (${model})...`);
        return await callOpenRouter(messages, tools, model);
      } catch (err: any) {
        const status = err.status || 0;
        console.error(`OpenRouter [${model}] falló (Status ${status})`);
        if (status === 401 || status === 400) break; // Errores fatales
      }
    }
  }

  // 4. ÚLTIMO RECURSO: Ollama (Local)
  try {
    console.log(`🏠 [LOCAL] Usando Ollama...`);
    return await callOllama(messages, tools);
  } catch (err) {
    console.error('Ollama también falló.');
  }

  throw new Error('⚠️ El agente está temporalmente sobrecargado. Inténtalo de nuevo en unos minutos.');
}


