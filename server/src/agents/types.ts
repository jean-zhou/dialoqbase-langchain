export type AgentMessage = {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  meta?: Record<string, any>;
};

export type ToolResult = {
  name: string;
  success: boolean;
  output?: any;
  error?: string;
};

export type AgentContext = {
  botId: string;
  promptVersion?: string;
  history: AgentMessage[];
};

export interface Tool {
  name: string;
  call(input: any, ctx: AgentContext): Promise<ToolResult>;
}


