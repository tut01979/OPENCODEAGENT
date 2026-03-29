import fs from 'fs';
import path from 'path';

const creds = './gmail-credentials.json';
const token = './token.json';

console.log('Project root contents:', fs.readdirSync('.'));
console.log('--- File Checks ---');
console.log(`Checking ${creds}...`);
if (fs.existsSync(creds)) {
  console.log(`✅ ${creds} exists as a ${fs.lstatSync(creds).isDirectory() ? 'directory' : 'file'}`);
  const data = fs.readFileSync(creds, 'utf-8');
  console.log(`   Size: ${data.length} bytes`);
  try {
    JSON.parse(data);
    console.log(`   JSON: Valid`);
  } catch (e) {
    console.log(`   JSON: Invalid (${e.message})`);
  }
} else {
  console.log(`❌ ${creds} NOT found`);
}

console.log(`\nChecking ${token}...`);
if (fs.existsSync(token)) {
  console.log(`✅ ${token} exists as a ${fs.lstatSync(token).isDirectory() ? 'directory' : 'file'}`);
  const data = fs.readFileSync(token, 'utf-8');
  console.log(`   Size: ${data.length} bytes`);
  try {
    const obj = JSON.parse(data);
    console.log(`   JSON: Valid`);
    console.log(`   Expiry: ${new Date(obj.expiry_date).toISOString()}`);
  } catch (e) {
    console.log(`   JSON: Invalid (${e.message})`);
  }
} else {
  console.log(`❌ ${token} NOT found`);
}
