import type { Tool, ToolCall, Message } from './types.js';
import { getCurrentTimeTool } from './time.js';
import { webSearchTool } from './webSearch.js';
import { readFileTool, writeFileTool } from './fileTools.js';
import { executeCommandTool } from './shellTools.js';
import { createCSVTool, readCSVTool } from './csvTools.js';
import { readEmailTool, sendEmailTool, getEmailDetailsTool, downloadAttachmentTool, markEmailAsReadTool } from './gmailTools.js';
import { createEventTool, listEventsTool } from './calendarTools.js';
import { uploadFileDriveTool, listDriveFilesTool, createDriveFolderTool, deleteDriveFileTool, readDriveFileTool, searchDriveFilesTool } from './driveTools.js';
import { textToSpeechTool } from './voiceTools.js';
import { readSheetTool, writeSheetTool, appendSheetTool, createSheetTool, listSheetsTool } from './sheetsTools.js';
import { getSubscriptionLinkTool, checkSubscriptionStatusTool } from './paymentTools.js';
import { payments } from '../services/payments.js';

const tools: Map<string, Tool> = new Map();
const FREE_TOOLS = ['get_subscription_link', 'check_subscription_status', 'get_current_time', 'help', 'start'];

export function registerTool(tool: Tool): void {
  tools.set(tool.name, tool);
}

export function getTool(name: string): Tool | undefined {
  return tools.get(name);
}

export function getAllTools(): Tool[] {
  return Array.from(tools.values());
}

export function getToolsForAPI(): Array<{
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Tool['parameters'];
  };
}> {
  return getAllTools().map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export async function executeToolCall(toolCall: ToolCall, userId: string): Promise<Message> {
  const tool = getTool(toolCall.name);
  if (!tool) {
    return {
      role: 'tool',
      content: `Error: Herramienta '${toolCall.name}' no encontrada`,
      tool_call_id: toolCall.id,
    };
  }

  // 💳 Middleware de Suscripción / Trial
  if (!FREE_TOOLS.includes(toolCall.name)) {
    const isActive = await payments.isSubscriptionActive(userId);
    if (!isActive) {
      return {
        role: 'tool',
        content: `❌ ACCESO DENEGADO ❌\n\nTu periodo de prueba ha terminado o no tienes una suscripción activa.\n\nPara seguir disfrutando de todas las capacidades industriales de OPENCODEAGENT, por favor suscríbete.\n\nPuedes generar un enlace de pago diciendo: "Quiero el enlace de suscripción mensual" o "anual".`,
        tool_call_id: toolCall.id,
      };
    }
  }

  try {
    const result = await tool.execute(toolCall.arguments, userId);
    return {
      role: 'tool',
      content: result,
      tool_call_id: toolCall.id,
    };
  } catch (error) {
    return {
      role: 'tool',
      content: `Error ejecutando ${toolCall.name}: ${error instanceof Error ? error.message : String(error)}`,
      tool_call_id: toolCall.id,
    };
  }
}

// Register default tools
registerTool(getCurrentTimeTool);
registerTool(webSearchTool);
registerTool(readFileTool);
registerTool(writeFileTool);
registerTool(executeCommandTool);
registerTool(createCSVTool);
registerTool(readCSVTool);
registerTool(readEmailTool);
registerTool(sendEmailTool);
registerTool(getEmailDetailsTool);
registerTool(downloadAttachmentTool);
registerTool(markEmailAsReadTool);
registerTool(createEventTool);
registerTool(listEventsTool);
registerTool(uploadFileDriveTool);
registerTool(listDriveFilesTool);
registerTool(createDriveFolderTool);
registerTool(deleteDriveFileTool);
registerTool(readDriveFileTool);
registerTool(searchDriveFilesTool);
registerTool(textToSpeechTool);
registerTool(readSheetTool);
registerTool(writeSheetTool);
registerTool(appendSheetTool);
registerTool(createSheetTool);
registerTool(listSheetsTool);
registerTool(getSubscriptionLinkTool);
registerTool(checkSubscriptionStatusTool);
