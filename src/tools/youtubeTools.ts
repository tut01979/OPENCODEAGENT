import { google } from 'googleapis';
import type { Tool } from './types.js';
import { config } from '../config.js';
import { firebase } from '../services/firebase.js';
import { generateAuthUrl, getOAuth2Client as getClientBase, getMasterToken } from '../services/auth.js';
import fs from 'fs';
import path from 'path';

async function getYouTubeClient(userId: string) {
  try {
    const oAuth2Client = getClientBase();
    if (!oAuth2Client) {
      console.error('❌ YouTube: No se pudo crear el cliente OAuth2. Verifica las credenciales de Google.');
      return null;
    }

    const userToken = await firebase.getUserToken(userId);
    if (userToken) {
      if (!userToken.access_token) {
        console.error(`❌ YouTube: Token encontrado para usuario ${userId} pero falta access_token. Token keys: ${Object.keys(userToken).join(', ')}`);
        return null;
      }
      if (!userToken.refresh_token) {
        console.warn(`⚠️ YouTube: Token para usuario ${userId} no tiene refresh_token. Funcionará solo mientras el access_token sea válido.`);
      }
      console.log(`✅ YouTube: Token encontrado para usuario ${userId}. Expiry: ${userToken.expiry_date ? new Date(userToken.expiry_date).toISOString() : 'desconocido'}`);
      
      oAuth2Client.setCredentials(userToken);
      
      // Intentar refrescar el token si está expirado o a punto de expirar
      try {
        const isExpired = !userToken.expiry_date || Date.now() >= userToken.expiry_date;
        if (isExpired && userToken.refresh_token) {
          console.log(`🔄 YouTube: Token expirado, refrescando automáticamente para usuario ${userId}`);
          const { credentials } = await oAuth2Client.refreshAccessToken();
          await firebase.saveUserToken(userId, credentials);
          console.log(`✅ YouTube: Token refrescado exitosamente para usuario ${userId}`);
        }
      } catch (refreshErr) {
        console.error(`❌ YouTube: No se pudo refrescar el token para usuario ${userId}:`, refreshErr);
        return null;
      }
      
      return { youtube: google.youtube({ version: 'v3', auth: oAuth2Client }), oAuth2Client };
    }

    if (userId === config.telegram.adminId) {
      const masterToken = getMasterToken();
      if (masterToken) {
        console.log(`✅ YouTube: Usando token maestro para admin ${userId}`);
        oAuth2Client.setCredentials(masterToken);
        return { youtube: google.youtube({ version: 'v3', auth: oAuth2Client }), oAuth2Client };
      }
    }

    console.warn(`⚠️ YouTube: No se encontró token para usuario ${userId} (no es admin o no hay master token)`);
    return null;
  } catch (err) {
    console.error(`❌ YouTube: Error inesperado en getYouTubeClient para usuario ${userId}:`, err);
    return null;
  }
}

function isInsufficientScopesError(err: unknown): boolean {
  const msg = String(err);
  const errObj = err as any;
  const details = errObj?.response?.data?.error?.message ||
                  errObj?.errors?.[0]?.message ||
                  errObj?.message ||
                  '';
  const fullMsg = msg + ' ' + details;
  return (
    fullMsg.includes('insufficient authentication scopes') ||
    fullMsg.includes('Request had insufficient authentication scopes') ||
    (fullMsg.includes('PERMISSION_DENIED') && fullMsg.includes('scope'))
  );
}

function isUnauthorizedError(err: unknown): boolean {
  const msg = String(err);
  const errObj = err as any;
  const details = errObj?.response?.data?.error?.message ||
                  errObj?.errors?.[0]?.message ||
                  errObj?.message ||
                  '';
  const fullMsg = msg + ' ' + details;
  return (
    fullMsg.includes('unauthorized_client') ||
    fullMsg.includes('invalid_grant') ||
    fullMsg.includes('Token has been expired') ||
    fullMsg.includes('Invalid Credentials') ||
    fullMsg.includes('Login Required') ||
    (errObj?.response?.status === 401)
  );
}

const YOUTUBE_REAUTH_MSG = (userId: string, reason: string) => {
  const url = generateAuthUrl(userId);
  if (!url) {
    return `🔐 **YouTube necesita autorización o reautorización.**

No se pudo generar el enlace de autorización automáticamente. Verifica que las credenciales de Google OAuth estén configuradas correctamente.`;
  }
  return `🔗 **YouTube necesita autorización o reautorización.**

${reason}

👉 **Autoriza aquí:** ${url}

Después de autorizar, vuelve a pedirme la acción y funcionará correctamente.`;
};

function formatDuration(isoDuration: string): string {
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return isoDuration;
  const h = match[1] ? `${match[1]}h ` : '';
  const m = match[2] ? `${match[2]}m ` : '';
  const s = match[3] ? `${match[3]}s` : '';
  return `${h}${m}${s}`.trim() || isoDuration;
}

export const searchYoutubeTool: Tool = {
  name: 'search_youtube',
  description: 'Busca videos en YouTube por término de búsqueda. Requiere autenticación OAuth.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Término de búsqueda' },
      max_results: { type: 'number', description: 'Número máximo de resultados (default 5)' },
    },
    required: ['query'],
  },
  execute: async (params, userId) => {
    const query = params.query as string;
    const maxResults = (params.max_results as number) || 5;

    try {
      const client = await getYouTubeClient(userId);
      if (!client) {
        return YOUTUBE_REAUTH_MSG(userId, 'No estás conectado a YouTube. Autoriza tu cuenta para buscar videos.');
      }

      console.log(`🎬 YouTube search: query="${query}" usando OAuth2`);

      const response = await client.youtube.search.list({
        part: ['snippet'],
        q: query,
        type: ['video'],
        maxResults: maxResults,
      });

      const items = response.data.items || [];

      if (items.length === 0) {
        return `No se encontraron videos para: "${query}"`;
      }

      let output = `🎬 **Resultados de YouTube para "${query}":**\n\n`;
      for (const item of items) {
        const title = item.snippet?.title || 'Sin título';
        const channel = item.snippet?.channelTitle || 'Canal desconocido';
        const videoId = item.id?.videoId;

        output += `📹 **${title}**\n`;
        output += `   Canal: ${channel}\n`;
        output += `   🔗 https://www.youtube.com/watch?v=${videoId}\n\n`;
      }

      return output;
    } catch (err) {
      console.error('Error en searchYoutubeTool:', err);
      if (isInsufficientScopesError(err)) {
        return YOUTUBE_REAUTH_MSG(userId, 'Tu autorización actual no tiene permisos para buscar en YouTube. Necesitas volver a autorizar.');
      }
      if (isUnauthorizedError(err)) {
        return YOUTUBE_REAUTH_MSG(userId, 'Tu sesión de YouTube ha expirado o es inválida.');
      }
      return `Error al buscar en YouTube: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export const listMyVideosTool: Tool = {
  name: 'list_my_youtube_videos',
  description: 'Lista los videos del canal de YouTube del usuario autenticado.',
  parameters: {
    type: 'object',
    properties: {
      max_results: { type: 'number', description: 'Número máximo de resultados (default 10)' },
    },
  },
  execute: async (params, userId) => {
    try {
      const client = await getYouTubeClient(userId);
      if (!client) return YOUTUBE_REAUTH_MSG(userId, 'No estás conectado a YouTube. Autoriza tu cuenta para acceder.');

      const maxResults = (params.max_results as number) || 10;

      const channelsRes = await client.youtube.channels.list({
        part: ['contentDetails'],
        mine: true,
      });

      const channels = channelsRes.data.items || [];
      if (channels.length === 0) {
        return 'No se encontró tu canal de YouTube. ¿Tienes uno creado?';
      }

      const uploadsPlaylistId = channels[0].contentDetails?.relatedPlaylists?.uploads;
      if (!uploadsPlaylistId) {
        return 'No se pudo acceder a tus videos subidos.';
      }

      const playlistRes = await client.youtube.playlistItems.list({
        part: ['snippet', 'contentDetails'],
        playlistId: uploadsPlaylistId,
        maxResults: maxResults,
      });

      const videos = playlistRes.data.items || [];
      if (videos.length === 0) {
        return 'No tienes videos subidos en tu canal.';
      }

      let output = `🎬 **Tus videos subidos (${videos.length}):**\n\n`;
      for (const video of videos) {
        const snippet = video.snippet;
        const videoId = video.contentDetails?.videoId;
        const title = snippet?.title || 'Sin título';
        const publishedAt = snippet?.publishedAt ? new Date(snippet.publishedAt).toLocaleDateString('es-ES') : 'Fecha desconocida';

        output += `📹 **${title}**\n`;
        output += `   📅 ${publishedAt}\n`;
        output += `   🔗 https://www.youtube.com/watch?v=${videoId}\n\n`;
      }

      return output;
    } catch (err) {
      console.error('Error en listMyVideosTool:', err);
      if (isInsufficientScopesError(err)) {
        return YOUTUBE_REAUTH_MSG(userId, 'Tu autorización actual no tiene permisos suficientes para YouTube. Necesitas volver a autorizar con los scopes actualizados.');
      }
      if (isUnauthorizedError(err)) {
        return YOUTUBE_REAUTH_MSG(userId, 'Tu sesión de YouTube ha expirado o es inválida.');
      }
      return `Error al listar tus videos: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export const getVideoDetailsTool: Tool = {
  name: 'get_youtube_video_details',
  description: 'Obtiene detalles de un video de YouTube por su ID o URL.',
  parameters: {
    type: 'object',
    properties: {
      video_id: { type: 'string', description: 'ID del video o URL completa de YouTube' },
    },
    required: ['video_id'],
  },
  execute: async (params, userId) => {
    let videoId = params.video_id as string;

    const urlMatch = videoId.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
    if (urlMatch) {
      videoId = urlMatch[1];
    }

    try {
      const apiKey = process.env.YOUTUBE_API_KEY || process.env.GOOGLE_API_KEY;
      if (!apiKey) {
        return YOUTUBE_REAUTH_MSG(userId, 'La API de YouTube no está configurada. Necesitas autorizar tu cuenta de Google primero.');
      }

      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${videoId}&key=${apiKey}`
      );

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        if (res.status === 403 || errBody.includes('PERMISSION_DENIED')) {
          return YOUTUBE_REAUTH_MSG(userId, 'La API de YouTube denegó el acceso. Es posible que necesites reautorizar tu cuenta.');
        }
        return `Error obteniendo detalles del video: ${res.statusText}`;
      }

      const data = await res.json() as any;
      const items = data.items || [];

      if (items.length === 0) {
        return `No se encontró el video con ID: ${videoId}`;
      }

      const video = items[0];
      const snippet = video.snippet || {};
      const stats = video.statistics || {};
      const contentDetails = video.contentDetails || {};

      let output = `🎬 **${snippet.title || 'Sin título'}**\n\n`;
      output += `📹 Canal: ${snippet.channelTitle || 'Desconocido'}\n`;
      output += `📅 Publicado: ${snippet.publishedAt ? new Date(snippet.publishedAt).toLocaleDateString('es-ES') : 'Desconocido'}\n`;
      output += `👁️ Vistas: ${stats.viewCount || 'N/A'}\n`;
      output += `👍 Likes: ${stats.likeCount || 'N/A'}\n`;
      output += `💬 Comentarios: ${stats.commentCount || 'N/A'}\n`;
      output += `⏱️ Duración: ${contentDetails.duration || 'N/A'}\n\n`;
      output += `📝 Descripción:\n${(snippet.description || '').slice(0, 500)}${snippet.description?.length > 500 ? '...' : ''}\n\n`;
      output += `🔗 https://www.youtube.com/watch?v=${videoId}`;

      return output;
    } catch (err) {
      return `Error al obtener detalles del video: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export const uploadToYouTubeTool: Tool = {
  name: 'upload_to_youtube',
  description: 'Sube un video a YouTube desde un archivo local o Drive. Requiere autenticacion OAuth.',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Ruta del archivo de video (local o Drive)' },
      title: { type: 'string', description: 'Titulo del video' },
      description: { type: 'string', description: 'Descripcion del video (opcional)' },
      tags: { type: 'string', description: 'Tags separados por comas (opcional)' },
      category_id: { type: 'string', description: 'ID de categoria (default: 22 para Personas y Blogs)' },
      privacy_status: { type: 'string', description: 'public, private o unlisted (default: private)' },
    },
    required: ['file_path', 'title'],
  },
  execute: async (params, userId) => {
    try {
      const client = await getYouTubeClient(userId);
      if (!client) return YOUTUBE_REAUTH_MSG(userId, 'No estás conectado a YouTube. Autoriza tu cuenta para subir videos.');

      const filePath = params.file_path as string;
      const title = params.title as string;
      const description = (params.description as string) || '';
      const tags = (params.tags as string) ? (params.tags as string).split(',').map(t => t.trim()) : [];
      const categoryId = (params.category_id as string) || '22';
      const privacyStatus = (params.privacy_status as string) || 'private';

      const resolvedPath = path.resolve(filePath);
      if (!fs.existsSync(resolvedPath)) {
        return `⚠️ Archivo no encontrado: ${resolvedPath}`;
      }

      const fileSize = fs.statSync(resolvedPath).size;
      const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);
      console.log(`📤 Subiendo video: ${title} (${fileSizeMB} MB)...`);

      const response = await client.youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title,
            description,
            tags,
            categoryId,
          },
          status: {
            privacyStatus,
          },
        },
        media: {
          body: fs.createReadStream(resolvedPath),
        },
      });

      const videoId = response.data.id;
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

      return `✅ **Video subido a YouTube**

📹 **${title}**
🆔 ID: ${videoId}
🔒 Privacidad: ${privacyStatus}
📁 Tamano: ${fileSizeMB} MB
🔗 Ver video: ${videoUrl}`;
    } catch (err) {
      console.error('Error subiendo video:', err);
      if (isInsufficientScopesError(err)) {
        return YOUTUBE_REAUTH_MSG(userId, 'Tu autorización actual no tiene permisos de subida para YouTube. Necesitas volver a autorizar con los scopes actualizados.');
      }
      if (isUnauthorizedError(err)) {
        return YOUTUBE_REAUTH_MSG(userId, 'Tu sesión de YouTube ha expirado o es inválida.');
      }
      return `Error subiendo video: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export const getChannelAnalyticsTool: Tool = {
  name: 'get_youtube_channel_analytics',
  description: 'Obtiene estadisticas y analytics de tu canal de YouTube. Requiere autenticacion OAuth.',
  parameters: {
    type: 'object',
    properties: {
      period_days: { type: 'number', description: 'Dias atras para el analisis (default 30)' },
    },
  },
  execute: async (params, userId) => {
    try {
      const client = await getYouTubeClient(userId);
      if (!client) return YOUTUBE_REAUTH_MSG(userId, 'No estás conectado a YouTube. Autoriza tu cuenta para ver analytics.');

      const daysAgo = (params.period_days as number) || 30;

      const channelsRes = await client.youtube.channels.list({
        part: ['snippet', 'statistics', 'contentDetails', 'brandingSettings'],
        mine: true,
      });

      const channels = channelsRes.data.items || [];
      if (channels.length === 0) {
        return 'No se encontro tu canal de YouTube.';
      }

      const channel = channels[0];
      const stats = channel.statistics || {};
      const snippet = channel.snippet || {};
      const branding = channel.brandingSettings || {};

      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysAgo);

      let output = `📊 **Analytics de tu canal de YouTube**\n\n`;
      output += `📌 **${snippet.title || 'Mi canal'}**\n`;
      output += `👥 Suscriptores: ${Number(stats.subscriberCount || 0).toLocaleString('es-ES')}\n`;
      output += `🎬 Total videos: ${Number(stats.videoCount || 0).toLocaleString('es-ES')}\n`;
      output += `👁️ Total vistas: ${Number(stats.viewCount || 0).toLocaleString('es-ES')}\n`;
      if (snippet.publishedAt) {
        output += `📅 Canal creado: ${new Date(snippet.publishedAt).toLocaleDateString('es-ES')}\n`;
      }
      if (branding.channel?.title) {
        output += `🏷️ Categoria: ${branding.channel.title}\n`;
      }
      if (branding.channel?.keywords) {
        output += `🔑 Keywords: ${branding.channel.keywords}\n`;
      }
      output += `\n📈 **Periodo de analisis:** ultimos ${daysAgo} dias`;
      output += `\n📅 Desde: ${startDate.toLocaleDateString('es-ES')} hasta ${endDate.toLocaleDateString('es-ES')}`;

      try {
        const accessToken = await client.oAuth2Client.getAccessToken();

        const analyticsUrl = `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${startDate.toISOString().split('T')[0]}&endDate=${endDate.toISOString().split('T')[0]}&metrics=views,likes,comments,subscribersGained,estimatedMinutesWatched,averageViewDuration&access_token=${accessToken}`;
        const analyticsRes = await fetch(analyticsUrl);

        if (analyticsRes.ok) {
          const data = await analyticsRes.json() as any;
          if (data.rows && data.rows.length > 0) {
            const row = data.rows[0];
            const headers = data.columnHeaders || [];
            const metrics: Record<string, string> = {};
            headers.forEach((h: any, i: number) => {
              if (h.name) metrics[h.name] = row[i] !== null ? String(row[i]) : '0';
            });

            output += `\n\n📊 **Metricas del periodo:**\n`;
            output += `👁️ Vistas: ${Number(metrics.views || 0).toLocaleString('es-ES')}\n`;
            output += `👍 Likes: ${Number(metrics.likes || 0).toLocaleString('es-ES')}\n`;
            output += `💬 Comentarios: ${Number(metrics.comments || 0).toLocaleString('es-ES')}\n`;
            output += `👥 Nuevos suscriptores: ${Number(metrics.subscribersGained || 0).toLocaleString('es-ES')}\n`;
            output += `⏱️ Minutos vistos: ${Number(metrics.estimatedMinutesWatched || 0).toLocaleString('es-ES')}\n`;
            if (metrics.averageViewDuration) {
              output += `⏰ Duracion media de visionado: ${formatDuration(`PT${Math.floor(Number(metrics.averageViewDuration))}S`)}\n`;
            }
          }
        } else if (analyticsRes.status === 403) {
          output += `\n\n⚠️ No tienes permisos de analytics. Vuelve a autorizar con los scopes de YouTube Analytics.`;
        }
      } catch (analyticsErr) {
        output += `\n\n⚠️ No se pudieron obtener metricas detalladas del periodo.`;
      }

      return output;
    } catch (err) {
      console.error('Error en analytics:', err);
      if (isInsufficientScopesError(err)) {
        return YOUTUBE_REAUTH_MSG(userId, 'Tu autorización actual no tiene permisos de analytics. Necesitas volver a autorizar con los scopes de YouTube Analytics.');
      }
      if (isUnauthorizedError(err)) {
        return YOUTUBE_REAUTH_MSG(userId, 'Tu sesión de YouTube ha expirado o es inválida.');
      }
      return `Error obteniendo analytics: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export const listYouTubeCommentsTool: Tool = {
  name: 'list_youtube_comments',
  description: 'Lista los comentarios de un video de YouTube o de tu canal. Requiere autenticacion OAuth.',
  parameters: {
    type: 'object',
    properties: {
      video_id: { type: 'string', description: 'ID del video (opcional, si no se pone muestra comentarios de tu canal)' },
      max_results: { type: 'number', description: 'Numero maximo de comentarios (default 20)' },
      order: { type: 'string', description: 'Orden: time o relevance (default: time)' },
    },
  },
  execute: async (params, userId) => {
    try {
      const client = await getYouTubeClient(userId);
      if (!client) return YOUTUBE_REAUTH_MSG(userId, 'No estás conectado a YouTube. Autoriza tu cuenta para ver comentarios.');

      const maxResults = (params.max_results as number) || 20;
      const order = (params.order as string) || 'time';
      let videoId = params.video_id as string;

      if (!videoId) {
        const channelsRes = await client.youtube.channels.list({
          part: ['contentDetails'],
          mine: true,
        });
        const channels = channelsRes.data.items || [];
        if (channels.length === 0) return 'No se encontro tu canal de YouTube.';
        const uploadsPlaylistId = channels[0].contentDetails?.relatedPlaylists?.uploads;
        if (!uploadsPlaylistId) return 'No se pudo acceder a tus videos.';

        const playlistRes = await client.youtube.playlistItems.list({
          part: ['contentDetails'],
          playlistId: uploadsPlaylistId,
          maxResults: 1,
        });
        const videos = playlistRes.data.items || [];
        if (videos.length === 0) return 'No tienes videos en tu canal.';
        videoId = videos[0].contentDetails?.videoId || '';
      }

      const commentsRes = await client.youtube.commentThreads.list({
        part: ['snippet', 'replies'],
        videoId,
        maxResults,
        order,
        textFormat: 'plainText',
      });

      const comments = commentsRes.data.items || [];
      if (comments.length === 0) {
        return `No hay comentarios en este video.`;
      }

      let output = `💬 **Comentarios (${comments.length}):**\n\n`;
      let index = 1;
      for (const comment of comments) {
        const topComment = comment.snippet?.topLevelComment?.snippet;
        if (!topComment) continue;

        const author = topComment.authorDisplayName || 'Anonimo';
        const text = topComment.textDisplay || '';
        const likeCount = topComment.likeCount || 0;
        const publishedAt = topComment.publishedAt ? new Date(topComment.publishedAt).toLocaleDateString('es-ES') : '';
        const replyCount = comment.snippet?.totalReplyCount || 0;

        output += `${index}. **${author}** (${publishedAt}) - ${likeCount} likes\n`;
        output += `   ${text.slice(0, 200)}${text.length > 200 ? '...' : ''}\n`;
        if (replyCount > 0) {
          output += `   💬 ${replyCount} respuesta(s)\n`;
        }
        output += `\n`;
        index++;
      }

      return output;
    } catch (err) {
      console.error('Error en comentarios:', err);
      if (isInsufficientScopesError(err)) {
        return YOUTUBE_REAUTH_MSG(userId, 'Tu autorización actual no tiene permisos para leer comentarios. Necesitas volver a autorizar.');
      }
      if (isUnauthorizedError(err)) {
        return YOUTUBE_REAUTH_MSG(userId, 'Tu sesión de YouTube ha expirado o es inválida.');
      }
      return `Error obteniendo comentarios: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export const updateYouTubeVideoTool: Tool = {
  name: 'update_youtube_video',
  description: 'Actualiza el titulo, descripcion, tags o privacidad de un video de YouTube. Requiere autenticacion OAuth.',
  parameters: {
    type: 'object',
    properties: {
      video_id: { type: 'string', description: 'ID del video a actualizar' },
      title: { type: 'string', description: 'Nuevo titulo (opcional)' },
      description: { type: 'string', description: 'Nueva descripcion (opcional)' },
      tags: { type: 'string', description: 'Nuevos tags separados por comas (opcional)' },
      category_id: { type: 'string', description: 'Nueva categoria (opcional)' },
      privacy_status: { type: 'string', description: 'public, private o unlisted (opcional)' },
    },
    required: ['video_id'],
  },
  execute: async (params, userId) => {
    try {
      const client = await getYouTubeClient(userId);
      if (!client) return YOUTUBE_REAUTH_MSG(userId, 'No estás conectado a YouTube. Autoriza tu cuenta para editar videos.');

      const videoId = params.video_id as string;

      const current = await client.youtube.videos.list({
        part: ['snippet', 'status'],
        id: [videoId],
      });

      const currentVideo = current.data.items?.[0];
      if (!currentVideo) {
        return `No se encontro el video con ID: ${videoId}`;
      }

      const snippet = currentVideo.snippet || {};
      const status = currentVideo.status || {};

      const updateSnippet: any = { ...snippet };
      const updateStatus: any = { ...status };

      if (params.title) updateSnippet.title = params.title;
      if (params.description !== undefined) updateSnippet.description = params.description;
      if (params.tags) updateSnippet.tags = (params.tags as string).split(',').map(t => t.trim());
      if (params.category_id) updateSnippet.categoryId = params.category_id;
      if (params.privacy_status) updateStatus.privacyStatus = params.privacy_status;

      const response = await client.youtube.videos.update({
        part: ['snippet', 'status'],
        requestBody: {
          id: videoId,
          snippet: updateSnippet,
          status: updateStatus,
        },
      });

      const updatedTitle = response.data.snippet?.title || params.title;
      const updatedPrivacy = response.data.status?.privacyStatus || params.privacy_status;
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

      return `✅ **Video actualizado**

📹 **${updatedTitle}**
🔒 Privacidad: ${updatedPrivacy}
🔗 Ver video: ${videoUrl}`;
    } catch (err) {
      console.error('Error actualizando video:', err);
      if (isInsufficientScopesError(err)) {
        return YOUTUBE_REAUTH_MSG(userId, 'Tu autorización actual no tiene permisos para editar videos. Necesitas volver a autorizar.');
      }
      if (isUnauthorizedError(err)) {
        return YOUTUBE_REAUTH_MSG(userId, 'Tu sesión de YouTube ha expirado o es inválida.');
      }
      return `Error actualizando video: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export const deleteYouTubeVideoTool: Tool = {
  name: 'delete_youtube_video',
  description: 'Elimina un video de YouTube permanentemente. Requiere autenticacion OAuth.',
  parameters: {
    type: 'object',
    properties: {
      video_id: { type: 'string', description: 'ID del video a eliminar' },
    },
    required: ['video_id'],
  },
  execute: async (params, userId) => {
    try {
      const client = await getYouTubeClient(userId);
      if (!client) return YOUTUBE_REAUTH_MSG(userId, 'No estás conectado a YouTube. Autoriza tu cuenta para eliminar videos.');

      const videoId = params.video_id as string;

      const current = await client.youtube.videos.list({
        part: ['snippet'],
        id: [videoId],
      });

      const title = current.data.items?.[0]?.snippet?.title || videoId;

      await client.youtube.videos.delete({
        id: videoId,
      });

      return `🗑️ **Video eliminado de YouTube**

📹 ${title}
🆔 ID: ${videoId}

⚠️ Esta accion es irreversible.`;
    } catch (err) {
      console.error('Error eliminando video:', err);
      if (isInsufficientScopesError(err)) {
        return YOUTUBE_REAUTH_MSG(userId, 'Tu autorización actual no tiene permisos para eliminar videos. Necesitas volver a autorizar.');
      }
      if (isUnauthorizedError(err)) {
        return YOUTUBE_REAUTH_MSG(userId, 'Tu sesión de YouTube ha expirado o es inválida.');
      }
      return `Error eliminando video: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export const getYoutubeAuthLinkTool: Tool = {
  name: 'get_youtube_auth_link',
  description: 'Devuelve el enlace de autorizacion para conectar o reconectar YouTube con Google OAuth.',
  parameters: {
    type: 'object',
    properties: {},
  },
  execute: async (params, userId) => {
    return YOUTUBE_REAUTH_MSG(userId, 'Para conectar tu cuenta de Google con YouTube, autoriza usando el siguiente enlace:');
  },
};
