import { Tool, AgentContext, ToolResult } from "../types";
import { embeddings } from "../../utils/embeddings";
import { getModelInfo } from "../../utils/get-model-info";
import { createRetriever } from "../../handlers/api/v1/bot/playground/chat.service";

export const retrieveTool: Tool = {
  name: "retrieve",
  async call(input: { query: string }, ctx: AgentContext): Promise<ToolResult> {
    try {
      const prisma: any = (global as any).__fastify_prisma || null;
      if (!prisma) return { name: "retrieve", success: false, error: "no prisma" };
      const bot = await prisma.bot.findFirst({ where: { id: ctx.botId } });
      if (!bot) return { name: "retrieve", success: false, error: "bot not found" };
      const embeddingInfo = await getModelInfo({ model: bot.embedding, prisma, type: "all" });
      const embeddingModel = embeddings(
        embeddingInfo.model_provider!.toLowerCase(),
        embeddingInfo.model_id,
        embeddingInfo?.config
      );
      const retriever = await createRetriever(bot, embeddingModel);
      const docs = await retriever.getRelevantDocuments(input.query);
      return { name: "retrieve", success: true, output: docs };
    } catch (e: any) {
      return { name: "retrieve", success: false, error: String(e?.message || e) };
    }
  },
};


