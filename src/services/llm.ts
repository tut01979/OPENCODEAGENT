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

async function callOllama(messages: Message[], tools?: unknown[]): Promise<LLMResponse> {
  // Convertir mensajes al formato de Ollama
  const ollamaMessages = messages.map(m => ({
    role: m.role,
    content: m.content || '',
  }));

  const response = await fetch(`${config.ollama.baseUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.ollama.model,
      messages: ollamaMessages,
      stream: false,
      options: {
        temperature: 0.3,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Ollama error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  
  return {
    content: data.message?.content || null,
    toolCalls: undefined,
  };
}

async function callGroq(messages: Message[], tools?: unknown[]): Promise<LLMResponse> {
  const lastMessage = messages[messages.length - 1];
  const hasImages = messages.some(m => {
    if (Array.isArray(m.content)) {
      return (m.content as any[]).some((c: any) => c.type === 'image_url');
    }
    return false;
  });
  
  // Groq no soporta imágenes, saltar si hay contenido multimodal
  if (hasImages) {
    throw new Error('Groq no soporta imágenes, saltando...');
  }
  
  // Groq para texto de alta velocidad (usando 70B para mejor razonamiento)
  const model = config.groq.model;
  console.log(`🤖 Groq (Text): ${model} | hasImages: ${hasImages}`);

  // Convertir contenido multimodal a string (por si hay arrays en el historial)
  const cleanedMessages = messages.map(m => {
    if (Array.isArray(m.content)) {
      // Extraer solo texto del contenido multimodal
      const textParts = (m.content as any[])
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text);
      return { ...m, content: textParts.join('\n') || '[Contenido multimodal - imagen no disponible]' };
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
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Groq API error: ${response.status} - ${error}`);
  }

  const data: APIResponse = await response.json();
  return parseResponse(data);
}

async function callOpenRouter(messages: Message[], tools?: unknown[], forceModel?: string): Promise<LLMResponse> {
  if (!config.openrouter.apiKey) {
    throw new Error('OpenRouter API key not configured');
  }

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
      temperature: 0.3,  // Deterministic behavior for maximum precision and reducing hallucinations
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
  }

  const data: APIResponse = await response.json();
  return parseResponse(data);
}

function cleanResponse(text: string | null): string | null {
  if (!text) return null;
  
  // Filtrar TODOS los mensajes basura que puedan venir del LLM
  let cleaned = text;
  
  // Remover system-reminder y variaciones
  cleaned = cleaned.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '');
  cleaned = cleaned.replace(/\[system-reminder\][\s\S]*?\[\/system-reminder\]/gi, '');
  
  // Remover mensajes sobre operational mode
  cleaned = cleaned.replace(/Your operational mode[\s\S]*?tools as needed\./gi, '');
  cleaned = cleaned.replace(/Operational mode[\s\S]*?changed[\s\S]*?\./gi, '');
  cleaned = cleaned.replace(/You are no longer[\s\S]*?\./gi, '');
  cleaned = cleaned.replace(/You are permitted[\s\S]*?tools[\s\S]*?\./gi, '');
  
  // Remover mensajes de otros asistentes de IA
  cleaned = cleaned.replace(/<\|assistant\|>[\s\S]*?<\|\/assistant\|>/gi, '');
  cleaned = cleaned.replace(/\[INST\][\s\S]*?\[\/INST\]/gi, '');
  cleaned = cleaned.replace(/<<SYS>>[\s\S]*?<\/SYS>>/gi, '');
  
  // 🛡️ Limpieza avanzada de caracteres extraños y repeticiones (Anti-Gravity Fix)
  cleaned = cleaned.replace(/#{3,}/g, '###'); // Normalizar títulos excesivos
  cleaned = cleaned.replace(/(\*\*\s*){2,}/g, '**'); // Quitar negritas repetitivas vacías
  cleaned = cleaned.replace(/(\n\s*){3,}/g, '\n\n'); // Max 2 saltos de línea
  cleaned = cleaned.replace(/[\u2500-\u257F\u2580-\u259F]/g, ''); // Dibujo de cajas residual
  
  // Limpiar líneas vacías extras
  cleaned = cleaned.replace(/^\s*\n/gm, '').trim();
  
  return cleaned || null;
}

function parseResponse(data: APIResponse): LLMResponse {
  const choice = data.choices[0];
  if (!choice) {
    throw new Error('No response choices from API');
  }

  const message = choice.message;
  
  // Limpiar contenido
  const content = cleanResponse(message.content);
  
  let toolCalls: ToolCall[] | undefined;
  if (message.tool_calls && message.tool_calls.length > 0) {
    try {
      toolCalls = message.tool_calls.map(tc => {
        let args = {};
        try {
          args = JSON.parse(tc.function.arguments);
          console.log(`🛠️ Tool call arguments: ${JSON.stringify(args)}`);
        } catch (err) {
          console.error(`Error parsing tool arguments for ${tc.function.name}:`, err);
          args = {};
        }
        return {
          id: tc.id,
          type: 'function' as const,
          name: tc.function.name,
          arguments: args,
        };
      });
    } catch (e) {
      console.error('Error parsing tool calls:', e);
      toolCalls = undefined;
    }
  }

  // Si no hay contenido ni tool_calls, devolver null para que el agente responda
  if (!content && !toolCalls) {
    return { content: null, toolCalls: undefined };
  }

  return {
    content,
    toolCalls: toolCalls?.length ? toolCalls : undefined,
  };
}

export async function chat(messages: Message[], tools?: unknown[]): Promise<LLMResponse> {
  const lastMessage = messages[messages.length - 1];
  const lastContent = lastMessage?.content;
  
  const hasImages = Array.isArray(lastContent) && (lastContent as any).some((c: any) => c.type === 'image_url');
  
  // PRIORIDAD 1: OpenRouter (Híbrido)
  if (config.openrouter.apiKey) {
    try {
      // Elegir Gemini si hay imagen, si no usar el modelo de texto (GPT-4o mini)
      const targetModel = hasImages ? config.openrouter.model : (config.openrouter as any).textModel;
      console.log(`🧠 IA Híbrida [OpenRouter]: Usando ${targetModel} (Imágenes: ${hasImages})`);
      return await callOpenRouter(messages, tools, targetModel);
    } catch (orError) {
      console.error('OpenRouter principal falló:', orError);
    }
  }

  // PRIORIDAD 2: Groq (Llama 3.3 70B) - Alta velocidad, buen razonamiento
  if (config.groq.apiKey) {
    try {
      console.log(`🤖 Usando Groq (Llama 70B)...`);
      return await callGroq(messages, tools);
    } catch (groqError) {
      console.error('Groq principal falló:', groqError);
    }
  }

  // PRIORIDAD 3: Ollama (Local)
  try {
    console.log(`🏠 Usando Ollama (Local)...`);
    return await callOllama(messages, tools);
  } catch (ollamaError) {
    console.error('Ollama falló:', ollamaError);
    throw new Error('Ningún servicio de LLM disponible. Configura OPENROUTER_API_KEY o GROQ_API_KEY.');
  }
}
