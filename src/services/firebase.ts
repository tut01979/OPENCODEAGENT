import admin from 'firebase-admin';
import { config } from '../config.js';
import fs from 'fs';
import path from 'path';

interface FirebaseMessage {
  userId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

class FirebaseService {
  private db: admin.firestore.Firestore | null = null;
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      const saPath = config.firebase.credentials;
      let initConfig: admin.AppOptions = {};

      if (saPath && fs.existsSync(saPath)) {
        console.log(`🔑 Usando credenciales de: ${saPath}`);
        const serviceAccountStr = fs.readFileSync(path.resolve(saPath), 'utf8');
        const serviceAccount = JSON.parse(serviceAccountStr);
        // Siempre confiar en el JSON de Firebase si existe, ignorando env confusas.
        initConfig = {
          credential: admin.credential.cert(serviceAccount),
          projectId: serviceAccount.project_id || config.firebase.projectId,
        };
      } else {
        initConfig = {
          credential: admin.credential.applicationDefault(),
          projectId: config.firebase.projectId,
        };
      }

      admin.initializeApp(initConfig);

      this.db = admin.firestore();
      
      // Especificamos literalmente "default" como databaseId debido a la configuración de Firebase
      // de la base de datos creada. Firebase Admin por defecto busca "(default)".
      try {
        this.db.settings({ databaseId: 'default' });
      } catch (e) {
        console.warn('⚠️ No se pudo asignar databaseId explícito:', e);
      }

      this.initialized = true;
      console.log(`✅ Firebase conectado correctamente (Proyecto: ${initConfig.projectId}, Database: default)`);
    } catch (error) {
      console.warn('⚠️  Error conectando Firebase:', error);
      console.warn('   Usando solo SQLite local.');
    }
  }

  async saveMessage(userId: string, role: 'user' | 'assistant' | 'system', content: string): Promise<void> {
    if (!this.db) return;

    try {
      await this.db.collection('conversations').add({
        userId,
        role,
        content,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (error: any) {
      // Silenciar errores de conexión de Firestore (opcional)
    }
  }

  async getConversation(userId: string, limit = 20): Promise<FirebaseMessage[]> {
    if (!this.db) return [];

    try {
      const snapshot = await this.db
        .collection('conversations')
        .where('userId', '==', userId)
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();

      return snapshot.docs.map(doc => ({
        userId: doc.data().userId,
        role: doc.data().role,
        content: doc.data().content,
        timestamp: doc.data().timestamp?.toDate() || new Date(),
      })).reverse();
    } catch (error) {
      console.error('Error obteniendo conversación de Firebase:', error);
      return [];
    }
  }

  async clearConversation(userId: string): Promise<void> {
    if (!this.db) return;

    try {
      const snapshot = await this.db
        .collection('conversations')
        .where('userId', '==', userId)
        .get();

      const batch = this.db.batch();
      snapshot.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    } catch (error) {
      console.error('Error limpiando conversación de Firebase:', error);
    }
  }

  isConnected(): boolean {
    return this.initialized && this.db !== null;
  }
}

export const firebase = new FirebaseService();
