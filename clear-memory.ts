import { memory } from './src/services/memory.js';

console.log('Limpiando memoria de conversaciones...');
memory.clearConversation('1572946817'); // Tu user ID
console.log('✅ Memoria limpiada');
memory.close();
process.exit(0);
