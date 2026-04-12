import { google } from 'googleapis';
import type { Tool } from './types.js';
import { config } from '../config.js';
import { firebase } from '../services/firebase.js';
import { generateAuthUrl, getOAuth2Client as getClientBase, getMasterToken } from '../services/auth.js';
import { sanitizeOutput, SEP } from '../utils/sanitize.js';

async function getCalendarClient(userId: string) {
  try {
    const oAuth2Client = getClientBase();
    if (!oAuth2Client) return null;

    const userToken = await firebase.getUserToken(userId);
    if (userToken) {
      oAuth2Client.setCredentials(userToken);
      return google.calendar({ version: 'v3', auth: oAuth2Client });
    }

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

function isUnauthorizedError(err: unknown): boolean {
  const msg = String(err);
  return msg.includes('unauthorized_client') || msg.includes('invalid_grant') || msg.includes('Token has been expired') || msg.includes('Invalid Credentials');
}

const AUTH_ERROR_MSG = (userId: string) => {
  const url = generateAuthUrl(userId);
  return `Tu sesion de Google ha expirado. Autoriza de nuevo:

${url}

Tras autorizar, vuelve a Telegram.`;
};

export const createEventTool: Tool = {
  name: 'create_event',
  description: 'Crea un evento en Google Calendar. Usa fechas ISO.',
  parameters: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'Titulo del evento' },
      description: { type: 'string', description: 'Descripcion del evento' },
      start_datetime: { type: 'string', description: 'Fecha/hora inicio (ISO: 2024-03-20T10:00:00)' },
      end_datetime: { type: 'string', description: 'Fecha/hora fin (ISO: 2024-03-20T11:00:00)' },
      timezone: { type: 'string', description: 'Zona horaria (default: Europe/Madrid)' },
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
        start: { dateTime: startDatetime, timeZone: timezone },
        end: { dateTime: endDatetime, timeZone: timezone },
      };

      const response = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: event,
      });

      const eventLink = response.data.htmlLink || `https://calendar.google.com/calendar/r/eventedit/${response.data.id}`;

      return `✅ **Evento creado en Google Calendar**
${SEP}
📅 **${summary}**
🕐 **Inicio:** ${startDatetime}
🕐 **Fin:** ${endDatetime}
🌐 **Zona horaria:** ${timezone}
🔗 **Enlace directo:** ${eventLink}
${SEP}`;
    } catch (error) {
      if (isUnauthorizedError(error)) return AUTH_ERROR_MSG(userId);
      return `Error creando evento: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

export const listEventsTool: Tool = {
  name: 'list_events',
  description: 'Lista los proximos eventos de Google Calendar. Usa days_ahead=1 para ver los de hoy.',
  parameters: {
    type: 'object',
    properties: {
      max_results: { type: 'number', description: 'Maximo eventos (default 10)' },
      days_ahead: { type: 'number', description: 'Dias hacia adelante desde hoy a las 00:00 (default 7)' },
      start_date: { type: 'string', description: 'Fecha inicio ISO opcional (ej: 2026-04-11T00:00:00). Si no se indica usa las 00:00 de hoy.' },
    },
    required: [],
  },
  execute: async (params, userId) => {
    const maxResults = (params.max_results as number) || 10;
    const daysAhead = (params.days_ahead as number) || 7;

    const calendar = await getCalendarClient(userId);
    if (!calendar) return AUTH_ERROR_MSG(userId);

    try {
      // Usar inicio del día (00:00) en lugar de "ahora" para no perder eventos matutinos
      let timeMin: Date;
      if (params.start_date) {
        timeMin = new Date(params.start_date as string);
      } else {
        timeMin = new Date();
        timeMin.setHours(0, 0, 0, 0); // inicio del día local
      }

      const timeMax = new Date(timeMin);
      timeMax.setDate(timeMax.getDate() + daysAhead);

      const response = await calendar.events.list({
        calendarId: 'primary',
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        maxResults,
        singleEvents: true,
        orderBy: 'startTime',
      });

      const events = response.data.items || [];
      if (events.length === 0) {
        return `No hay eventos en los proximos ${daysAhead} dias (desde ${timeMin.toLocaleDateString('es-ES')}).`;
      }

      let output = `Tienes ${events.length} eventos proximos:\n\n`;
      let index = 1;
      for (const event of events) {
        const startRaw = event.start?.dateTime || event.start?.date || '';
        const endRaw = event.end?.dateTime || event.end?.date || '';
        const link = event.htmlLink || `https://calendar.google.com/calendar/r/eventedit/${event.id}`;

        let startStr = '';
        let endStr = '';
        if (startRaw) {
          const d = new Date(startRaw);
          if (!isNaN(d.getTime())) {
            const hora = d.getHours();
            const horaStr = hora.toString().padStart(2, '0');
            const min = d.getMinutes().toString().padStart(2, '0');
            const dia = d.getDate().toString().padStart(2, '0');
            const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
            const mes = meses[d.getMonth()];
            let periodo = '';
            if (hora >= 6 && hora < 12) periodo = ' de la manana';
            else if (hora >= 12 && hora < 14) periodo = ' del mediodia';
            else if (hora >= 14 && hora < 20) periodo = ' de la tarde';
            else if (hora >= 20 && hora < 24) periodo = ' de la noche';
            else periodo = ' de la madrugada';
            startStr = `dia ${dia} de ${mes} a las ${horaStr}:${min}${periodo}`;
          } else {
            startStr = startRaw;
          }
        }
        if (endRaw) {
          const d = new Date(endRaw);
          if (!isNaN(d.getTime())) {
            const hora = d.getHours();
            const horaStr = hora.toString().padStart(2, '0');
            const min = d.getMinutes().toString().padStart(2, '0');
            let periodo = '';
            if (hora >= 6 && hora < 12) periodo = ' de la manana';
            else if (hora >= 12 && hora < 14) periodo = ' del mediodia';
            else if (hora >= 14 && hora < 20) periodo = ' de la tarde';
            else if (hora >= 20 && hora < 24) periodo = ' de la noche';
            else periodo = ' de la madrugada';
            endStr = `hasta las ${horaStr}:${min}${periodo}`;
          } else {
            endStr = endRaw;
          }
        }

        output += `${index}. ${event.summary || 'Sin titulo'}\n`;
        if (startStr) output += `   Hora del evento: ${startStr}\n`;
        if (endStr) output += `   Fin: ${endStr}\n`;
        output += `   Enlace: ${link}\n\n`;
        index++;
      }

      return sanitizeOutput(output);
    } catch (error) {
      if (isUnauthorizedError(error)) return AUTH_ERROR_MSG(userId);
      return `Error listando eventos: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

export const getCalendarLinkTool: Tool = {
  name: 'get_calendar_link',
  description: 'Devuelve el enlace directo a Google Calendar',
  parameters: {
    type: 'object',
    properties: {},
  },
  execute: async () => {
    return `📅 **Tu Calendario de Google:**

🔗 **Enlace directo:** https://calendar.google.com/

(Asegúrate de estar logueado con la cuenta que autorizaste)`;
  },
};

export const updateEventTool: Tool = {
  name: 'update_event',
  description: 'Actualiza un evento existente en Google Calendar',
  parameters: {
    type: 'object',
    properties: {
      event_id: { type: 'string', description: 'ID del evento a actualizar' },
      summary: { type: 'string', description: 'Nuevo titulo (opcional)' },
      description: { type: 'string', description: 'Nueva descripcion (opcional)' },
      start_datetime: { type: 'string', description: 'Nueva fecha/hora inicio ISO (opcional)' },
      end_datetime: { type: 'string', description: 'Nueva fecha/hora fin ISO (opcional)' },
    },
    required: ['event_id'],
  },
  execute: async (params, userId) => {
    const eventId = params.event_id as string;
    const calendar = await getCalendarClient(userId);
    if (!calendar) return AUTH_ERROR_MSG(userId);

    try {
      // Obtener evento actual
      const existing = await calendar.events.get({ calendarId: 'primary', eventId });
      const eventData = existing.data;

      // Actualizar solo los campos proporcionados
      const updateData: any = {};
      if (params.summary) updateData.summary = params.summary;
      if (params.description) updateData.description = params.description;
      if (params.start_datetime) {
        updateData.start = { dateTime: params.start_datetime, timeZone: eventData.start?.timeZone || 'Europe/Madrid' };
      }
      if (params.end_datetime) {
        updateData.end = { dateTime: params.end_datetime, timeZone: eventData.end?.timeZone || 'Europe/Madrid' };
      }

      const response = await calendar.events.update({
        calendarId: 'primary',
        eventId,
        requestBody: { ...eventData, ...updateData },
      });

      const link = response.data.htmlLink || `https://calendar.google.com/calendar/r/eventedit/${eventId}`;

      return `✅ **Evento actualizado**
${SEP}
📌 **${response.data.summary}**
🔗 **Enlace directo:** ${link}
${SEP}`;
    } catch (error) {
      if (isUnauthorizedError(error)) return AUTH_ERROR_MSG(userId);
      return `Error actualizando evento: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

export const deleteEventTool: Tool = {
  name: 'delete_event',
  description: 'Elimina un evento de Google Calendar',
  parameters: {
    type: 'object',
    properties: {
      event_id: { type: 'string', description: 'ID del evento a eliminar' },
    },
    required: ['event_id'],
  },
  execute: async (params, userId) => {
    const eventId = params.event_id as string;
    const calendar = await getCalendarClient(userId);
    if (!calendar) return AUTH_ERROR_MSG(userId);

    try {
      // Obtener nombre antes de eliminar
      const existing = await calendar.events.get({ calendarId: 'primary', eventId });
      const name = existing.data.summary || 'Sin titulo';

      await calendar.events.delete({ calendarId: 'primary', eventId });

      return `🗑️ **Evento eliminado**
${SEP}
📌 **${name}**
🆔 **ID:** ${eventId}
${SEP}`;
    } catch (error) {
      if (isUnauthorizedError(error)) return AUTH_ERROR_MSG(userId);
      return `Error eliminando evento: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};