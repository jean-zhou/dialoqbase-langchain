import { Orchestrator } from "../orchestrator";
import { retrieveTool } from "../tools/retrieve";
import { AgentContext, AgentMessage } from "../types";

export async function runSummarizePipeline(ctx: AgentContext): Promise<AgentMessage[]> {
  const plan = [
    { role: "assistant", prompt: "Researcher: I will retrieve relevant context." },
    { role: "assistant", prompt: "Retriever: fetching docs..." },
    { role: "tool", tool: "retrieve" },
    { role: "assistant", prompt: "Writer: I will write a concise summary based on retrieved docs." },
  ];
  const orch = new Orchestrator([retrieveTool]);
  const transcript = await orch.runPipeline(ctx, plan);
  return transcript;
}


