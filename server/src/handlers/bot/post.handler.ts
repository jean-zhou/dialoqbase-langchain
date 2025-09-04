import { FastifyReply, FastifyRequest } from "fastify";
import { ChatRequestBody } from "./types";
import { DialoqbaseVectorStore } from "../../utils/store";
import { embeddings } from "../../utils/embeddings";
import { chatModelProvider } from "../../utils/models";
import { BaseRetriever } from "@langchain/core/retrievers";
import { DialoqbaseHybridRetrival } from "../../utils/hybrid";
import { Document } from "langchain/document";
import { createChain, groupMessagesByConversation } from "../../chain";
import { getModelInfo } from "../../utils/get-model-info";
import { nextTick } from "../../utils/nextTick";
import { jwtBotVerify } from "../../utils/jwt";

export const chatRequestHandler = async (
  request: FastifyRequest<ChatRequestBody>,
  reply: FastifyReply
) => {
  const { message, history, history_id } = request.body;
  try {
    const public_id = request.params.id;

    const prisma = request.server.prisma;

    const bot = await prisma.bot.findFirst({
      where: {
        publicId: public_id,
      },
    });

    if (!bot) {
      return {
        bot: {
          text: "You are in the wrong place, buddy.",
          sourceDocuments: [],
        },
        history: [
          ...history,
          {
            type: "human",
            text: message,
          },
          {
            type: "ai",
            text: "You are in the wrong place, buddy.",
          },
        ],
      };
    }

    if (bot.bot_protect) {
      if (!request.session.get("is_bot_allowed")) {
        return {
          bot: {
            text: "You are not allowed to chat with this bot.",
            sourceDocuments: [],
          },
          history: [
            ...history,
            {
              type: "human",
              text: message,
            },
            {
              type: "ai",
              text: "You are not allowed to chat with this bot.",
            },
          ],
        };
      }
    }

    if (bot.publicBotPwdProtected) {
      const authorizationHeader = request.headers.authorization;
      if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
        return {
          bot: {
            text: "Invalid authorization header.",
            sourceDocuments: [],
          },
          history: [
            ...history,
            {
              type: "human",
              text: message,
            },
            {
              type: "ai",
              text: "Invalid authorization header.",
            },
          ],
        };
      }
      const token = authorizationHeader.split(" ")[1];

      const verify = await jwtBotVerify(token);

      if (!verify) {
        return {
          bot: {
            text: "Invalid authorization token.",
            sourceDocuments: [],
          },
          history: [
            ...history,
            {
              type: "human",
              text: message,
            },
            {
              type: "ai",
              text: "Invalid authorization token.",
            },
          ],
        };
      }

      if (verify.botId !== bot.publicId) {
        return {
          bot: {
            text: "Invalid authorization token.",
            sourceDocuments: [],
          },
          history: [
            ...history,
            {
              type: "human",
              text: message,
            },
            {
              type: "ai",
              text: "Invalid authorization token.",
            },
          ],
        };
      }
    }

    const temperature = bot.temperature;

    const sanitizedQuestion = message.trim().replaceAll("\n", " ");
    const embeddingInfo = await getModelInfo({
      model: bot.embedding,
      prisma,
      type: "embedding",
    });

    if (!embeddingInfo) {
      return {
        bot: {
          text: "There was an error processing your request.",
          sourceDocuments: [],
        },
        history: [
          ...history,
          {
            type: "human",
            text: message,
          },
          {
            type: "ai",
            text: "There was an error processing your request.",
          },
        ],
      };
    }

    const embeddingModel = embeddings(
      embeddingInfo.model_provider!.toLowerCase(),
      embeddingInfo.model_id,
      embeddingInfo?.config
    );
    let retriever: BaseRetriever;
    // let resolveWithDocuments: (value: Document[]) => void;
    // const documentPromise = new Promise<Document[]>((resolve) => {
    //   resolveWithDocuments = resolve;
    // });
    if (bot.use_hybrid_search) {
      retriever = new DialoqbaseHybridRetrival(embeddingModel, {
        botId: bot.id,
        sourceId: null,
        callbacks: [
          // {
          //   handleRetrieverEnd(documents) {
          //     resolveWithDocuments(documents);
          //   },
          // },
        ],
      });
    } else {
      const vectorstore = await DialoqbaseVectorStore.fromExistingIndex(
        embeddingModel,
        {
          botId: bot.id,
          sourceId: null,
        }
      );

      console.log('vectorstore.asRetriever--------');
      // retriever = vectorstore.asRetriever({
      //   // callbacks: [
      //   //   {
      //   //     handleRetrieverEnd(documents) {
      //   //       resolveWithDocuments(documents);  // TOFIX： 这个可能写错了，应该是没有文档的搜索，因为这里没有上传文档
      //   //     },
      //   //   },
      //   // ],
      // });
      retriever = vectorstore.asRetriever();
    }

    const modelinfo = await getModelInfo({
      model: bot.model,
      prisma,
      type: "chat",
    });

    if (!modelinfo) {
      return {
        bot: {
          text: "There was an error processing your request.",
          sourceDocuments: [],
        },
        history: [
          ...history,
          {
            type: "human",
            text: message,
          },
          {
            type: "ai",
            text: "There was an error processing your request.",
          },
        ],
      };
    }

    const botConfig: any = (modelinfo.config as {}) || {};
    if (bot.provider.toLowerCase() === "openai") {
      if (bot.bot_model_api_key && bot.bot_model_api_key.trim() !== "") {
        botConfig.configuration = {
          apiKey: bot.bot_model_api_key,
        };
      }
    }
    // temperature 参数控制模型的随机性参数，0 的话就不随机，1的话随机性最大
    // temperature 为1时，模型的返回会变慢
    // 目前由于框架的影响，如果模型返回超过 1s, 则直接报错，所以
    // TODO: model name 不需要时间戳
    const model = chatModelProvider(bot.provider, bot.model, temperature, {
      ...botConfig,
    });

    const chain = createChain({
      llm: model,
      question_llm: model,
      question_template: bot.questionGeneratorPrompt,
      response_template: bot.qaPrompt,
      retriever,
    });

    const input = {
      question: sanitizedQuestion,
      chat_history: groupMessagesByConversation(
        history.map((message) => ({
          type: message.type,
          content: message.text,
        }))
      ),
    } as any;
    // console.log('input--------', input);

    const botResponse = await chain.invoke(input);
    // console.log('botResponse--------', botResponse);

    // const documents = await documentPromise;
    const documents = await retriever.invoke(sanitizedQuestion);
    // console.log('documents--------', documents);

    const chatId = await prisma.botWebHistory.create({
      data: {
        chat_id: history_id,
        bot_id: bot.id,
        bot: botResponse,
        human: message,
        metadata: {
          ip: request?.ip,
          user_agent: request?.headers["user-agent"],
        },
        sources: documents.map((doc) => {
          return {
            ...doc,
          };
        }),
      },
    });

    return {
      bot: {
        chat_id: chatId.id,
        text: botResponse,
        sourceDocuments: documents,
      },
      history: [
        ...history,
        {
          type: "human",
          text: message,
        },
        {
          type: "ai",
          text: botResponse,
        },
      ],
    };
  } catch (e) {
    console.log('chatRequestHandler error', e);
    return {
      bot: {
        text: "There was an error processing your request.",
        sourceDocuments: [],
      },
      history: [
        ...history,
        {
          type: "human",
          text: message,
        },
        {
          type: "ai",
          text: "There was an error processing your request.",
        },
      ],
    };
  }
};

export const chatRequestStreamHandler = async (
  request: FastifyRequest<ChatRequestBody>,
  reply: FastifyReply
) => {
  const { message, history, history_id } = request.body;

  try {
    const public_id = request.params.id;
    // get user meta info from request
    // const meta = request.headers["user-agent"];
    // ip address

    // const history = JSON.parse(chatHistory) as {
    //   type: string;
    //   text: string;
    // }[];

    const prisma = request.server.prisma;

    const bot = await prisma.bot.findFirst({
      where: {
        publicId: public_id,
      },
    });

    if (!bot) {
      return {
        bot: {
          text: "You are in the wrong place, buddy.",
          sourceDocuments: [],
        },
        history: [
          ...history,
          {
            type: "human",
            text: message,
          },
          {
            type: "ai",
            text: "You are in the wrong place, buddy.",
          },
        ],
      };
    }

    if (bot.bot_protect) {
      if (!request.session.get("is_bot_allowed")) {
        reply.raw.setHeader("Content-Type", "text/event-stream");

        reply.sse({
          event: "result",
          id: "",
          data: JSON.stringify({
            bot: {
              text: "You are not allowed to chat with this bot.",
              sourceDocuments: [],
            },
            history: [
              ...history,
              {
                type: "human",
                text: message,
              },
              {
                type: "ai",
                text: "You are not allowed to chat with this bot.",
              },
            ],
          }),
        });

        await nextTick();

        return reply.raw.end();
      }
    }

    if (bot.publicBotPwdProtected) {
      const authorizationHeader = request.headers.authorization;
      if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
        reply.raw.setHeader("Content-Type", "text/event-stream");

        reply.sse({
          event: "result",
          id: "",
          data: JSON.stringify({
            bot: {
              text: "Invalid authorization header.",
              sourceDocuments: [],
            },
            history: [
              ...history,
              {
                type: "human",
                text: message,
              },
              {
                type: "ai",
                text: "Invalid authorization header.",
              },
            ],
          }),
        });
        await nextTick();

        return reply.raw.end();
      }
      const token = authorizationHeader.split(" ")[1];

      const verify = await jwtBotVerify(token);

      if (!verify) {
        reply.raw.setHeader("Content-Type", "text/event-stream");

        reply.sse({
          event: "result",
          id: "",
          data: JSON.stringify({
            bot: {
              text: "Invalid authorization token.",
              sourceDocuments: [],
            },
            history: [
              ...history,
              {
                type: "human",
                text: message,
              },
              {
                type: "ai",
                text: "Invalid authorization token.",
              },
            ],
          }),
        });
        await nextTick();

        return reply.raw.end();
      }

      if (verify.botId !== bot.publicId) {
        reply.raw.setHeader("Content-Type", "text/event-stream");

        reply.sse({
          event: "result",
          id: "",
          data: JSON.stringify({
            bot: {
              text: "Invalid authorization token.",
              sourceDocuments: [],
            },
            history: [
              ...history,
              {
                type: "human",
                text: message,
              },
              {
                type: "ai",
                text: "Invalid authorization token.",
              },
            ],
          }),
        });
        await nextTick();

        return reply.raw.end();
      }
    }

    const temperature = bot.temperature;

    const sanitizedQuestion = message.trim().replaceAll("\n", " ");
    const embeddingInfo = await getModelInfo({
      model: bot.embedding,
      prisma,
      type: "embedding",
    });

    if (!embeddingInfo) {
      return {
        bot: {
          text: "There was an error processing your request.",
          sourceDocuments: [],
        },
        history: [
          ...history,
          {
            type: "human",
            text: message,
          },
          {
            type: "ai",
            text: "There was an error processing your request.",
          },
        ],
      };
    }

    const embeddingModel = embeddings(
      embeddingInfo.model_provider!.toLowerCase(),
      embeddingInfo.model_id,
      embeddingInfo?.config
    );

    let retriever: BaseRetriever;
    let resolveWithDocuments: (value: Document[]) => void;
    const documentPromise = new Promise<Document[]>((resolve) => {
      resolveWithDocuments = resolve;
    });
    if (bot.use_hybrid_search) {
      retriever = new DialoqbaseHybridRetrival(embeddingModel, {
        botId: bot.id,
        sourceId: null,
        callbacks: [
          {
            handleRetrieverEnd(documents) {
              resolveWithDocuments(documents);
            },
          },
        ],
      });
    } else {
      const vectorstore = await DialoqbaseVectorStore.fromExistingIndex(
        embeddingModel,
        {
          botId: bot.id,
          sourceId: null,
        }
      );

      // Vectorstore 实现了一个 as_retriever 方法，该方法将生成一个 Retriever，特别是一个 VectorStoreRetriever。
      // 这些检索器包括特定的 search_type 和 search_kwargs 属性，用于标识要调用的基础向量存储的方法以及如何参数化它们。
      retriever = vectorstore.asRetriever({
        callbacks: [
          {
            handleRetrieverEnd(documents) {
              resolveWithDocuments(documents);
            },
          },
        ],
      });
    }

    reply.raw.on("close", () => {
      console.log("closed");
    });

    const modelinfo = await getModelInfo({
      model: bot.model,
      prisma,
      type: "chat",
    });

    if (!modelinfo) {
      reply.raw.setHeader("Content-Type", "text/event-stream");

      reply.sse({
        event: "result",
        id: "",
        data: JSON.stringify({
          bot: {
            text: "There was an error processing your request.",
            sourceDocuments: [],
          },
          history: [
            ...history,
            {
              type: "human",
              text: message,
            },
            {
              type: "ai",
              text: "There was an error processing your request.",
            },
          ],
        }),
      });
      await nextTick();

      return reply.raw.end();
    }

    const botConfig: any = (modelinfo.config as {}) || {};
    if (bot.provider.toLowerCase() === "openai") {
      if (bot.bot_model_api_key && bot.bot_model_api_key.trim() !== "") {
        botConfig.configuration = {
          apiKey: bot.bot_model_api_key,
        };
      }
    }

    const streamedModel = chatModelProvider(
      bot.provider,
      bot.model,
      temperature,
      {
        streaming: true,
        callbacks: [
          {
            handleLLMNewToken(token: string) {
              // if (token !== '[DONE]') {
              // console.log(token);
              return reply.sse({
                id: "",
                event: "chunk",
                data: JSON.stringify({
                  message: token || "",
                }),
              });
              // } else {
              // console.log("done");
              // }
            },
          },
        ],
        ...botConfig,
      }
    );

    const nonStreamingModel = chatModelProvider(
      bot.provider,
      bot.model,
      temperature,
      {
        streaming: false,
        ...botConfig,
      }
    );

    const chain = createChain({
      llm: streamedModel,
      question_llm: nonStreamingModel,
      question_template: bot.questionGeneratorPrompt,
      response_template: bot.qaPrompt,
      retriever,
    });

    let response = await chain.invoke({
      question: sanitizedQuestion,
      chat_history: groupMessagesByConversation(
        history.map((message) => ({
          type: message.type,
          content: message.text,
        }))
      ),
    });

    const documents = await documentPromise;

    const chatId = await prisma.botWebHistory.create({
      data: {
        chat_id: history_id,
        bot_id: bot.id,
        bot: response,
        human: message,
        metadata: {
          ip: request?.ip,
          user_agent: request?.headers["user-agent"],
        },
        sources: documents.map((doc) => {
          return {
            ...doc,
          };
        }),
      },
    });

    reply.sse({
      event: "result",
      id: "",
      data: JSON.stringify({
        bot: {
          chat_id: chatId.id,
          text: response,
          sourceDocuments: documents,
        },
        history: [
          ...history,
          {
            type: "human",
            text: message,
          },
          {
            type: "ai",
            text: response,
          },
        ],
      }),
    });
    await nextTick();
    return reply.raw.end();
  } catch (e) {
    console.log(e);
    reply.raw.setHeader("Content-Type", "text/event-stream");

    reply.sse({
      event: "result",
      id: "",
      data: JSON.stringify({
        bot: {
          text: "There was an error processing your request.",
          sourceDocuments: [],
        },
        history: [
          ...history,
          {
            type: "human",
            text: message,
          },
          {
            type: "ai",
            text: "There was an error processing your request.",
          },
        ],
      }),
    });
    await nextTick();

    return reply.raw.end();
  }
};
