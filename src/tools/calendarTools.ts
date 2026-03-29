import { google } from 'googleapis';
import fs from 'fs/promises';
import path from 'path';
import type { Tool } from './types.js';

const TOKEN_PATH = './token.json';
const CREDENTIALS_PATH = './gmail-credentials.json';

async function getCalendarClient() {
  try {
    const credentialsContent = await fs.readFile(path.resolve(CREDENTIALS_PATH), 'utf-8');
    const credentials = JSON.parse(credentialsContent);
    const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;

    const oAuth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris[0]
    );

    try {
      const tokenContent = await fs.readFile(path.resolve(TOKEN_PATH), 'utf-8');
      oAuth2Client.setCredentials(JSON.parse(tokenContent));
    } catch {
      return null;
    }

    return google.calendar({ version: 'v3', auth: oAuth2Client });
  } catch {
    return null;
  }
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
  execute: async (params) => {
    const summary = params.summary as string;
    const description = (params.description as string) || '';
    const startDatetime = params.start_datetime as string;
    const endDatetime = params.end_datetime as string;
    const timezone = (params.timezone as string) || 'Europe/Madrid';
    
    const calendar = await getCalendarClient();
    if (!calendar) {
      return '⚠️ Google Calendar no configurado. Necesitas configurar OAuth2 primero.';
    }
    
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
  execute: async (params) => {
    const maxResults = (params.max_results as number) || 10;
    const daysAhead = (params.days_ahead as number) || 7;
    
    const calendar = await getCalendarClient();
    if (!calendar) {
      return '⚠️ Google Calendar no configurado. Necesitas configurar OAuth2 primero.';
    }
    
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
      return `Error listando eventos: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};
