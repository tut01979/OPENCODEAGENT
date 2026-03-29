import { getCurrentTimeTool } from '../src/tools/time.js';
import { readEmailTool } from '../src/tools/gmailTools.js';
import { listEventsTool } from '../src/tools/calendarTools.js';
import { listDriveFilesTool } from '../src/tools/driveTools.js';
import { executeCommandTool } from '../src/tools/shellTools.js';

async function testTools() {
  console.log('--- Testing Tools Registration ---');
  const tools = [
    getCurrentTimeTool,
    readEmailTool,
    listEventsTool,
    listDriveFilesTool,
    executeCommandTool
  ];

  for (const tool of tools) {
    console.log(`Tool: ${tool.name} - ${tool.description}`);
    try {
      if (tool.name === 'get_current_time') {
        const res = await tool.execute({});
        console.log(`  ✅ get_current_time: ${res}`);
      } else if (tool.name === 'execute_command') {
        const res = await tool.execute({ command: 'node -v' });
        console.log(`  ✅ execute_command: ${res}`);
      } else {
        // These might fail if no credentials, but lets see output
        const res = await tool.execute({ max_results: 1 });
        console.log(`  Tool result: ${res}`);
      }
    } catch (e) {
      console.log(`  ❌ Error executing ${tool.name}: ${e.message}`);
    }
  }
}

testTools();
