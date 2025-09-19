import { FastifyReply, FastifyRequest } from "fastify";
import { ChatRequestBody } from "./types";
import { embeddings } from "../../../../../utils/embeddings";
import { createChain, groupMessagesByConversation } from "../../../../../chain";
import { getModelInfo } from "../../../../../utils/get-model-info";
import { nextTick } from "../../../../../utils/nextTick";
import { startSpan, endSpan, observePipelineLatency } from "../../../../../observability/metrics-helpers";
import {
  createChatModel,
  createRetriever,
  getBotConfig,
  handleErrorResponse,
  saveChatHistory,
} from "./chat.service";
import { getJson, setJsonTTL, makeKey, stableHash } from "../../../../../utils/cache";
import { incCacheHit } from "../../../../../observability/metrics-helpers";

export const chatRequestHandler = async (
  request: FastifyRequest<ChatRequestBody>,
  reply: FastifyReply
) => {
  const { id: bot_id } = request.params;
  const { message, history_id } = request.body;
  let history = [];

  try {
    const pipelineSpan = startSpan("pipeline.playground.chat", { bot_id });
    const t0 = Date.now();
    const prisma = request.server.prisma;
    const bot = await prisma.bot.findFirst({
      where: { id: bot_id, user_id: request.user.user_id },
    });

    if (!bot) {
      return handleErrorResponse(
        history,
        message,
        "You are in the wrong place, buddy."
      );
    }


    if (history_id) {
      const details = await prisma.botPlayground.findFirst({
        where: {
          id: history_id,
          botId: bot_id,
        },
        include: {
          BotPlaygroundMessage: {
            orderBy: {
              createdAt: "asc",
            },
          },
        },
      });

      const botMessages = details?.BotPlaygroundMessage.map((message) => ({
        type: message.type,
        text: message.message,
      }));

      history = botMessages || [];
    }

    const embeddingInfo = await getModelInfo({
      model: bot.embedding,
      prisma,
      type: "all",
    });

    if (!embeddingInfo) {
      return handleErrorResponse(history, message, "Unable to find Embedding");
    }

    const embeddingModel = embeddings(
      embeddingInfo.model_provider!.toLowerCase(),
      embeddingInfo.model_id,
      embeddingInfo?.config
    );

    const retriever = await createRetriever(bot, embeddingModel);

    const modelinfo = await getModelInfo({
      model: bot.model,
      prisma,
      type: "chat",
    });

    if (!modelinfo) {
      return handleErrorResponse(history, message, "Unable to find model");
    }

    const botConfig = getBotConfig(bot, modelinfo);
    const model = createChatModel(bot, bot.temperature, botConfig);

    const chain = createChain({
      llm: model,
      question_llm: model,
      question_template: bot.questionGeneratorPrompt,
      response_template: bot.qaPrompt,
      retriever,
    });

    const sanitizedQuestion = message.trim().replaceAll("\n", " ");
    // Generation-level cache
    const genCacheKey = makeKey([
      "gen",
      bot.id,
      bot.model,
      stableHash(bot.qaPrompt),
      stableHash(sanitizedQuestion),
      bot.noOfChatHistoryInContext,
    ]);
    const cachedGen = await getJson<any>(genCacheKey);
    if (cachedGen) {
      incCacheHit();
      return cachedGen;
    }
    const botResponse = await chain.invoke({
      question: sanitizedQuestion,
      chat_history: groupMessagesByConversation(
        history.slice(-bot.noOfChatHistoryInContext).map((message) => ({
          type: message.type,
          content: message.text,
        }))
      ),
    });

    // Retrieval-level cache
    const retCacheKey = makeKey([
      "ret",
      bot.id,
      stableHash(sanitizedQuestion),
      bot.use_hybrid_search,
      process.env.DB_USE_RERANK || "false",
    ]);
    let documents = await getJson<any[]>(retCacheKey);
    if (!documents) {
      documents = await retriever.getRelevantDocuments(sanitizedQuestion);
      await setJsonTTL(retCacheKey, documents);
    } else {
      incCacheHit();
    }
    const historyId = await saveChatHistory(
      prisma,
      bot.id,
      message,
      botResponse,
      history_id,
      documents
    );

    const ms = Date.now() - t0;
    observePipelineLatency(ms);
    endSpan(pipelineSpan);
    const resultPayload = {
      bot: { text: botResponse, sourceDocuments: documents },
      history: [
        ...history,
        { type: "human", text: message },
        { type: "ai", text: botResponse },
      ],
      history_id: historyId,
    };
    await setJsonTTL(genCacheKey, resultPayload);
    return resultPayload;
  } catch (e) {
    console.error(e);
    return handleErrorResponse(
      history,
      message,
      "There was an error processing your request."
    );
  }
};

export const chatRequestStreamHandler = async (
  request: FastifyRequest<ChatRequestBody>,
  reply: FastifyReply
) => {
  const { id: bot_id } = request.params;
  const { message, history_id } = request.body;
  let history = [];

  try {
    const pipelineSpan = startSpan("pipeline.playground.chat.stream", { bot_id });
    const t0 = Date.now();
    const prisma = request.server.prisma;
    const bot = await prisma.bot.findFirst({
      where: { id: bot_id, user_id: request.user.user_id },
    });

    if (!bot) {
      return handleErrorResponse(
        history,
        message,
        "You are in the wrong place, buddy."
      );
    }


    if (history_id) {
      const details = await prisma.botPlayground.findFirst({
        where: {
          id: history_id,
          botId: bot_id,
        },
        include: {
          BotPlaygroundMessage: {
            orderBy: {
              createdAt: "asc",
            },
          },
        },
      });

      const botMessages = details?.BotPlaygroundMessage.map((message) => ({
        type: message.type,
        text: message.message,
      }));

      history = botMessages || [];
    }



    const embeddingInfo = await getModelInfo({
      model: bot.embedding,
      prisma,
      type: "embedding",
    });

    if (!embeddingInfo) {
      return handleErrorResponse(
        history,
        message,
        "No embedding model found"
      );
    }

    const embeddingModel = embeddings(
      embeddingInfo.model_provider!.toLowerCase(),
      embeddingInfo.model_id,
      embeddingInfo?.config
    );

    const retriever = await createRetriever(bot, embeddingModel);

    const modelinfo = await getModelInfo({
      model: bot.model,
      prisma,
      type: "chat",
    });

    if (!modelinfo) {
      return handleErrorResponse(
        history,
        message,
        "Not model found"
      );
    }

    const botConfig = getBotConfig(bot, modelinfo);
    const streamedModel = createChatModel(
      bot,
      bot.temperature,
      botConfig,
      true
    );
    const nonStreamingModel = createChatModel(bot, bot.temperature, botConfig);

    reply.raw.setHeader("Content-Type", "text/event-stream");

    const chain = createChain({
      llm: streamedModel,
      question_llm: nonStreamingModel,
      question_template: bot.questionGeneratorPrompt,
      response_template: bot.qaPrompt,
      retriever,
    });

    const sanitizedQuestion = message.trim().replaceAll("\n", " ");
    let response = "";
    const stream = await chain.stream({
      question: sanitizedQuestion,
      chat_history: groupMessagesByConversation(
        history.slice(-bot.noOfChatHistoryInContext).map((message) => ({
          type: message.type,
          content: message.text,
        }))
      ) as any,
    });

    for await (const token of stream) {
      reply.sse({
        id: "",
        event: "chunk",
        data: JSON.stringify({ message: token || "" }),
      });
      response += token;
    }

    // const documents = await retriever.getRelevantDocuments(sanitizedQuestion);
    const documents = await retriever.invoke(sanitizedQuestion);
    const historyId = await saveChatHistory(
      prisma,
      bot.id,
      message,
      response,
      history_id,
      documents
    );

    const ms = Date.now() - t0;
    observePipelineLatency(ms);
    endSpan(pipelineSpan);
    reply.sse({
      event: "result",
      id: "",
      data: JSON.stringify({
        bot: { text: response, sourceDocuments: documents },
        history: [
          ...history,
          { type: "human", text: message },
          { type: "ai", text: response },
        ],
        history_id: historyId,
      }),
    });

    await nextTick();
    return reply.raw.end();
  } catch (e) {
    console.log('error: ', e);
    return handleErrorResponse(
      history,
      message,
      "Internal Server Error"
    );
  }
};
