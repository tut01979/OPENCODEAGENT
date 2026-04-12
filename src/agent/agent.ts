import { config } from '../config.js';
import { chat } from '../services/llm.js';
import { memory } from '../services/memory.js';
import { getToolsForAPI, executeToolCall } from '../tools/tools.js';
import type { Message, ToolCall, APIToolCall } from '../tools/types.js';
import { sanitizeOutput } from '../utils/sanitize.js';

export interface AgentResult {
  response: string;
  iterations: number;
  usedTools: string[];
}

const DANGEROUS_TOOLS = [
  'delete_drive_file',
  'send_gmail',
  'move_drive_file',
  'delete_youtube_video'
];


function toAPIToolCall(toolCall: ToolCall): APIToolCall {
  return {
    id: toolCall.id,
    type: 'function',
    function: {
      name: toolCall.name,
      arguments: JSON.stringify(toolCall.arguments),
    },
  };
}

export async function runAgent(userId: string, userInput: string | any[]): Promise<AgentResult> {
  // Save user message
  memory.saveMessage(userId, 'user', userInput);

  // Build conversation context
  const conversationHistory = await memory.getConversation(userId);
  const messages: Message[] = [
    { role: 'system', content: config.agent.getSystemPrompt() },
    ...conversationHistory.map(entry => {
      let content: any = entry.content;
      if (typeof content === 'string' && content.startsWith('[') && content.endsWith(']')) {
        try {
          const parsed = JSON.parse(content);
          // Solo parsear si parece un mensaje multimodal (array de objetos con 'type')
          if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].type) {
            content = parsed;
          }
        } catch {
          // Ignorar error y usar como string si no es JSON válido
        }
      }
      return {
        role: entry.role as 'user' | 'assistant',
        content: content,
      };
    }),
  ];

  const tools = getToolsForAPI();
  const usedTools: string[] = [];
  let iterations = 0;
  
  console.log(`🛠️ Agent [${userId}]: Enviando ${tools.length} herramientas al LLM: ${tools.map(t => t.function.name).join(', ')}`);

    while (iterations < config.agent.maxIterations) {
      iterations++;

      const response = await chat(messages, tools);
      console.log(`🧠 Agente iteración ${iterations}: content=${!!response.content}, toolCalls=${response.toolCalls?.length || 0}`);

      // Si no hay respuesta válida, devolver mensaje genérico
      if (!response.content && !response.toolCalls) {
        memory.saveMessage(userId, 'assistant', '¿En qué puedo ayudarte?');
        return { response: '¿En qué puedo ayudarte?', iterations, usedTools };
      }

      // If no tool calls, we have a final response
      if (!response.toolCalls || response.toolCalls.length === 0) {
        let finalResponse = response.content;
        
        // Si no hay contenido, responder genéricamente
        if (!finalResponse) {
          finalResponse = '¿En qué puedo ayudarte?';
        }

        // ✨ SANITIZACIÓN FINAL (Limpiar thinking blocks, chars de control, etc.)
        finalResponse = sanitizeOutput(finalResponse);
        
        console.log(`✅ Respuesta final generada (${finalResponse.length} chars)`);
        memory.saveMessage(userId, 'assistant', finalResponse);
        return { response: finalResponse, iterations, usedTools };
      }

      // Execute tool calls
      if (response.toolCalls && response.toolCalls.length > 0) {
        // Agrupar todas las llamadas en un único mensaje del asistente (estándar OpenAI/Gemini)
        const assistantToolMessage: Message = {
          role: 'assistant',
          content: response.content || null,
          tool_calls: response.toolCalls.map(tc => toAPIToolCall(tc))
        };
        messages.push(assistantToolMessage);

        for (const toolCall of response.toolCalls) {
          usedTools.push(toolCall.name);
          
          // 🛡️ CONFIRMACIÓN DE ACCIONES PELIGROSAS
          if (DANGEROUS_TOOLS.includes(toolCall.name)) {
            console.log(`⚠️ Interceptada herramienta peligrosa: ${toolCall.name}. Solicitando confirmación...`);
            memory.setPendingAction(userId, toolCall);
            // Si hay otras herramientas en la misma vuelta, se perderán, pero es mejor por seguridad.
            const warning = `⚠️ Esta acción (${toolCall.name}) es irreversible y afectará a tus archivos o comunicaciones reales. ¿Estás seguro? Responde **SÍ** para continuar.`;
            memory.saveMessage(userId, 'assistant', warning);
            return { response: warning, iterations, usedTools };
          }

          console.log(`🛠️ Ejecutando [${userId}]: ${toolCall.name}...`);
          const result = await executeToolCall(toolCall, userId);
          console.log(`📥 Resultado ${toolCall.name}: ${typeof result.content === 'string' ? result.content.substring(0, 50) : 'binary'}...`);
          
          // 🛡️ INTERCEPCIÓN DE SEGURIDAD SAAS (Auth links)
          const content = typeof result.content === 'string' ? result.content : '';
          if (content.includes('🔗') || content.includes('authorization') || content.includes('No estás conectado')) {
            console.log(`🔗 Interceptado enlace de autorización. Deteniendo agente.`);
            memory.saveMessage(userId, 'assistant', content);
            return { response: content, iterations, usedTools };
          }

          // Añadir el resultado de la herramienta al historial
          messages.push(result);
        }
        
        // Continuar el bucle while para que el LLM vea los resultados y decida qué hacer
        continue;
      }
    }

  // Max iterations reached
  const fallbackResponse = 'Alcanzé el límite de iteraciones. Por favor, intenta de nuevo con una pregunta más simple.';
  memory.saveMessage(userId, 'assistant', fallbackResponse);
  return { response: fallbackResponse, iterations, usedTools };
}

export function clearUserMemory(userId: string): void {
  memory.clearConversation(userId);
}
