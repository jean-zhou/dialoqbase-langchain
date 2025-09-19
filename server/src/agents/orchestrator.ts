import { AgentContext, AgentMessage, Tool } from "./types";
import { startSpan, endSpan } from "../observability/metrics-helpers";

export class Orchestrator {
  private tools: Record<string, Tool>;
  constructor(tools: Tool[]) {
    this.tools = Object.fromEntries(tools.map((t) => [t.name, t]));
  }

  async runPipeline(
    ctx: AgentContext,
    plan: Array<{ role: string; tool?: string; prompt?: string }>
  ): Promise<AgentMessage[]> {
    const span = startSpan("agents.orchestrator.run", { botId: ctx.botId });
    const transcript: AgentMessage[] = [];
    try {
      for (const step of plan) {
        if (step.tool) {
          const tool = this.tools[step.tool];
          if (!tool) continue;
          const input = { query: this.lastUserMessage(ctx) };
          const res = await tool.call(input, ctx);
          transcript.push({ role: "tool", content: JSON.stringify(res), meta: { tool: step.tool } });
          ctx.history.push({ role: "tool", content: JSON.stringify(res), meta: { tool: step.tool } });
        } else if (step.prompt) {
          transcript.push({ role: "assistant", content: step.prompt });
          ctx.history.push({ role: "assistant", content: step.prompt });
        }
      }
      return transcript;
    } finally {
      endSpan(span);
    }
  }

  private lastUserMessage(ctx: AgentContext): string {
    for (let i = ctx.history.length - 1; i >= 0; i--) {
      if (ctx.history[i].role === "user") return ctx.history[i].content;
    }
    return "";
  }
}


