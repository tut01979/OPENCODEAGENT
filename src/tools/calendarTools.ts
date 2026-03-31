import { google } from 'googleapis';
import type { Tool } from './types.js';
import { config } from '../config.js';
import { firebase } from '../services/firebase.js';
import { generateAuthUrl, getOAuth2Client as getClientBase, getMasterToken } from '../services/auth.js';

async function getCalendarClient(userId: string) {
  try {
    const oAuth2Client = getClientBase();
    if (!oAuth2Client) return null;

    const userToken = await firebase.getUserToken(userId);
    if (userToken) {
      oAuth2Client.setCredentials(userToken);
      return google.calendar({ version: 'v3', auth: oAuth2Client });
    }

    // 🛡️ MASTER TOKEN FALLBACK (Solo Administrador)
    if (userId === config.telegram.adminId) {
      const masterToken = getMasterToken();
      if (masterToken) {
        oAuth2Client.setCredentials(masterToken);
        return google.calendar({ version: 'v3', auth: oAuth2Client });
      }
    }

    return null;
  } catch {
    return null;
  }
}

const AUTH_ERROR_MSG = (userId: string) => {
  const url = generateAuthUrl(userId);
  return `🔑 **Tu sesión de Google ha expirado.**\n\nNecesito que autorices de nuevo. Solo es una vez:\n\n🔗 ${url}\n\nAl hacer clic, serás redirigido a Google. Tras autorizar, vuelve a Telegram y repite tu solicitud.`;
};

function isUnauthorizedError(err: unknown): boolean {
  const msg = String(err);
  return msg.includes('unauthorized_client') || msg.includes('invalid_grant') || msg.includes('Token has been expired') || msg.includes('Invalid Credentials');
}

export const createEventTool: Tool = {
  name: 'create_event',
  description: 'Crea un evento en Google Calendar. Requiere configuración OAuth2.',
  parameters: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'Título del evento',
      },
      description: {
        type: 'string',
        description: 'Descripción del evento',
      },
      start_datetime: {
        type: 'string',
        description: 'Fecha y hora de inicio (formato ISO: 2024-03-20T10:00:00)',
      },
      end_datetime: {
        type: 'string',
        description: 'Fecha y hora de fin (formato ISO: 2024-03-20T11:00:00)',
      },
      timezone: {
        type: 'string',
        description: 'Zona horaria (default: Europe/Madrid)',
      },
    },
    required: ['summary', 'start_datetime', 'end_datetime'],
  },
  execute: async (params, userId) => {
    const summary = params.summary as string;
    const description = (params.description as string) || '';
    const startDatetime = params.start_datetime as string;
    const endDatetime = params.end_datetime as string;
    const timezone = (params.timezone as string) || 'Europe/Madrid';
    
    const calendar = await getCalendarClient(userId);
    if (!calendar) return AUTH_ERROR_MSG(userId);
    
    try {
      const event = {
        summary,
        description,
        start: {
          dateTime: startDatetime,
          timeZone: timezone,
        },
        end: {
          dateTime: endDatetime,
          timeZone: timezone,
        },
      };
      
      const response = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: event,
      });
      
      return `✅ Evento creado:\nTítulo: ${summary}\nInicio: ${startDatetime}\nFin: ${endDatetime}\nLink: ${response.data.htmlLink}`;
    } catch (error) {
      if (isUnauthorizedError(error)) return AUTH_ERROR_MSG(userId);
      return `Error creando evento: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

export const listEventsTool: Tool = {
  name: 'list_events',
  description: 'Lista los próximos eventos de Google Calendar. Requiere configuración OAuth2.',
  parameters: {
    type: 'object',
    properties: {
      max_results: {
        type: 'number',
        description: 'Número máximo de eventos (default: 10)',
      },
      days_ahead: {
        type: 'number',
        description: 'Días hacia adelante para buscar (default: 7)',
      },
    },
    required: [],
  },
  execute: async (params, userId) => {
    const maxResults = (params.max_results as number) || 10;
    const daysAhead = (params.days_ahead as number) || 7;
    
    const calendar = await getCalendarClient(userId);
    if (!calendar) return AUTH_ERROR_MSG(userId);
    
    try {
      const now = new Date();
      const future = new Date();
      future.setDate(future.getDate() + daysAhead);
      
      const response = await calendar.events.list({
        calendarId: 'primary',
        timeMin: now.toISOString(),
        timeMax: future.toISOString(),
        maxResults,
        singleEvents: true,
        orderBy: 'startTime',
      });
      
      const events = response.data.items || [];
      
      if (events.length === 0) {
        return `No hay eventos en los próximos ${daysAhead} días`;
      }
      
      const eventList = events.map(event => {
        const start = event.start?.dateTime || event.start?.date;
        const end = event.end?.dateTime || event.end?.date;
        const link = event.htmlLink ? `\n  🔗 Link: ${event.htmlLink}` : '';
        return `- *${event.summary}*\n  Inicio: ${start}\n  Fin: ${end}${link}`;
      });
      
      return `Próximos ${events.length} eventos:\n\n${eventList.join('\n\n')}`;
    } catch (error) {
      if (isUnauthorizedError(error)) return AUTH_ERROR_MSG(userId);
      return `Error listando eventos: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};
