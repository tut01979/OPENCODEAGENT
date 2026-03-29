import { listDriveFilesTool } from '../src/tools/driveTools.js';

async function testDrive() {
  console.log('--- Testing Drive Tool ---');
  try {
    const res = await listDriveFilesTool.execute({ max_results: 1 });
    console.log(`✅ Result: ${res}`);
  } catch (e) {
    console.error(`❌ Error: ${e.message}`);
  }
}

testDrive();
