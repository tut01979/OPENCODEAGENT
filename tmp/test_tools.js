import fs from 'fs';
import path from 'path';

const TOKEN_PATH = './token.json';
const CREDENTIALS_PATH = './gmail-credentials.json';

async function testPaths() {
  console.log('CWD:', process.cwd());
  console.log('--- Checking Credentials File ---');
  const credPath = path.resolve(CREDENTIALS_PATH);
  console.log('Resolved Credentials Path:', credPath);
  try {
    const exists = fs.existsSync(credPath);
    console.log('Exists:', exists);
    if (exists) {
      const content = fs.readFileSync(credPath, 'utf-8');
      console.log('Content Start:', content.substring(0, 50));
      const json = JSON.parse(content);
      console.log('Parsed successfully');
      const { client_id, client_secret, redirect_uris } = json.installed || json.web || {};
      console.log('client_id:', !!client_id);
      console.log('client_secret:', !!client_secret);
      console.log('redirect_uris:', redirect_uris);
    }
  } catch (err) {
    console.error('Error with credentials:', err.message);
  }

  console.log('\n--- Checking Token File ---');
  const tokenPath = path.resolve(TOKEN_PATH);
  console.log('Resolved Token Path:', tokenPath);
  try {
    const exists = fs.existsSync(tokenPath);
    console.log('Exists:', exists);
    if (exists) {
      const content = fs.readFileSync(tokenPath, 'utf-8');
      console.log('Content Start:', content.substring(0, 50));
      const json = JSON.parse(content);
      console.log('Parsed successfully');
      console.log('Expiry:', new Date(json.expiry_date).toISOString());
    }
  } catch (err) {
    console.error('Error with token:', err.message);
  }
}

testPaths();
