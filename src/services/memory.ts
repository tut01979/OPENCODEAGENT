import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { firebase } from './firebase.js';

export interface MemoryEntry {
  id: number;
  userId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

class MemoryService {
  private db: Database.Database;

  constructor() {
    const dbDir = path.dirname(config.db.path);
    if (!fs.existsSync(dbDir)) {
      console.log(`📂 Creando directorio para base de datos: ${dbDir}`);
      fs.mkdirSync(dbDir, { recursive: true });
    }
    
    this.db = new Database(config.db.path);
    this.init();
    this.initFirebase();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL DEFAULT (unixepoch())
      );
      
      CREATE INDEX IF NOT EXISTS idx_conversations_userId 
      ON conversations(userId);
      
      CREATE INDEX IF NOT EXISTS idx_conversations_timestamp 
      ON conversations(timestamp);
    `);
  }

  private async initFirebase(): Promise<void> {
    await firebase.init();
  }

  saveMessage(userId: string, role: 'user' | 'assistant' | 'system', content: string | any[]): void {
    const contentToSave = typeof content === 'string' ? content : JSON.stringify(content);
    
    // Guardar en SQLite local
    const stmt = this.db.prepare(
      'INSERT INTO conversations (userId, role, content) VALUES (?, ?, ?)'
    );
    stmt.run(userId, role, contentToSave);

    // Sincronizar con Firebase en segundo plano
    firebase.saveMessage(userId, role, contentToSave).catch(err => {
      console.error('Error sincronizando con Firebase:', err);
    });
  }

  async getConversation(userId: string, limit = 20): Promise<MemoryEntry[]> {
    // 1. Fallback rápido: Leer de SQLite que es instantáneo
    const stmt = this.db.prepare(
      'SELECT * FROM conversations WHERE userId = ? ORDER BY timestamp DESC LIMIT ?'
    );
    const localDocs = (stmt.all(userId, limit) as MemoryEntry[]).reverse();

    // 2. Si tenemos historial local, lo usamos directamente para no bloquear con peticiones de red (evita quedarse "queued")
    if (localDocs.length > 0) {
      return localDocs;
    }

    // 3. Si SQLite está vacío (ej. tras redesplegar la app), recuperamos de Firebase
    if (firebase.isConnected()) {
      try {
        const fbDocs = await firebase.getConversation(userId, limit);
        if (fbDocs.length > 0) {
          // Hidratar SQLite para que los siguientes mensajes sean rápidos
          const insertStmt = this.db.prepare(
            'INSERT INTO conversations (userId, role, content) VALUES (?, ?, ?)'
          );
          for (const doc of fbDocs) {
             insertStmt.run(doc.userId, doc.role, doc.content);
          }

          return fbDocs.map((doc, idx) => ({
             id: idx,
             userId: doc.userId,
             role: doc.role,
             content: doc.content,
             timestamp: doc.timestamp.getTime()
          }));
        }
      } catch (err) {
        console.error('Error recuperando de Firebase:', err);
      }
    }
    
    return [];
  }

  clearConversation(userId: string): void {
    // Limpiar SQLite
    const stmt = this.db.prepare('DELETE FROM conversations WHERE userId = ?');
    stmt.run(userId);

    // Limpiar Firebase en segundo plano
    firebase.clearConversation(userId).catch(err => {
      console.error('Error limpiando Firebase:', err);
    });
  }

  close(): void {
    this.db.close();
  }
}

export const memory = new MemoryService();
