import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';

const serviceAccountStr = fs.readFileSync(path.resolve('./service-account.json'), 'utf8');
const serviceAccount = JSON.parse(serviceAccountStr);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: serviceAccount.project_id,
});

// PASS 'default' INSTEAD OF undefined
const db = admin.firestore(); // Wait, getFirestore takes App? Let's use getFirestore from 'firebase-admin/firestore'

async function testFirebase() {
  try {
    const db2 = admin.firestore();
    db2.settings({ databaseId: 'default' }); // Try with explicit literal 'default' instead of '(default)'
    
    const docRef = await db2.collection('conversations').add({
      userId: 'test1234',
      role: 'system',
      content: 'test',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    fs.writeFileSync('result.json', JSON.stringify({ success: true, docId: docRef.id, test: "literal default" }));
  } catch (error) {
    fs.writeFileSync('result.json', JSON.stringify({
      success: false,
      name: error.name,
      message: error.message,
      code: error.code,
      details: error.details,
    }, null, 2));
  }
}

testFirebase();
