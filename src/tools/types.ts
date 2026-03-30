export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required?: string[];
  };
  execute: (params: Record<string, unknown>, userId: string) => Promise<string> | string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  name: string;
  arguments: Record<string, unknown>;
}

export interface APIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | any[] | null;
  tool_calls?: APIToolCall[];
  tool_call_id?: string;
}
