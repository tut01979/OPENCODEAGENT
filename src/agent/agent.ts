import { config } from '../config.js';
import { chat } from '../services/llm.js';
import { memory } from '../services/memory.js';
import { getToolsForAPI, executeToolCall } from '../tools/tools.js';
import type { Message, ToolCall, APIToolCall } from '../tools/types.js';

export interface AgentResult {
  response: string;
  iterations: number;
  usedTools: string[];
}

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
    { role: 'system', content: config.agent.systemPrompt },
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
      
      memory.saveMessage(userId, 'assistant', finalResponse);
      return { response: finalResponse, iterations, usedTools };
    }

    // Execute tool calls
    for (const toolCall of response.toolCalls) {
      usedTools.push(toolCall.name);
      const result = await executeToolCall(toolCall);
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: [toAPIToolCall(toolCall)],
      });
      messages.push(result);
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
