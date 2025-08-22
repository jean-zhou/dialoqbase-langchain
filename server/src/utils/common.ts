import { PrismaClient } from "@prisma/client";

export const getSettings = (prisma: PrismaClient) => {
  const settings = prisma.dialoqbaseSettings.findFirst({
    where: {
      // TODO: setting 的 id 是写死的，应该根据每个用户组去设置 id，每个用户组可以自己设置自己的配置信息
      // 一个团队共享一个配置信息，由团队的管理员设置，所以一个团队应该有一个 group id，setting 的 id 是 group id
      // 现在先假设只有一个团队，所以 id 是 1
      id: 1,  
    },
  });

  if (!settings) {
    const defaultSettings = prisma.dialoqbaseSettings.create({
      data: {
        id: 1,
        allowUserToCreateBots: true,
        allowUserToRegister: false,
        noOfBotsPerUser: 10,
        fileUploadSizeLimit: 10
      },
    });

    return defaultSettings;
  }

  return settings;
};
