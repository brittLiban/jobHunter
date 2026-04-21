import type { SignupInput } from "@jobhunter/core";

import { prisma } from "./index";

export async function createCredentialUser(input: SignupInput & { passwordHash: string }) {
  return prisma.user.create({
    data: {
      email: input.email.toLowerCase(),
      fullName: input.fullName,
      passwordHash: input.passwordHash,
    },
  });
}

export async function getUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: {
      profile: true,
      preferences: true,
      resumes: {
        include: {
          versions: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      },
    },
  });
}

export async function createSession(userId: string, sessionToken: string, expiresAt: Date) {
  return prisma.userSession.create({
    data: {
      userId,
      sessionToken,
      expiresAt,
    },
  });
}

export async function deleteSession(sessionToken: string) {
  await prisma.userSession.deleteMany({
    where: { sessionToken },
  });
}

export async function getSessionUser(sessionToken: string) {
  const session = await prisma.userSession.findUnique({
    where: { sessionToken },
    include: {
      user: {
        include: {
          profile: true,
          preferences: true,
          resumes: {
            include: {
              versions: true,
            },
            orderBy: {
              createdAt: "desc",
            },
          },
        },
      },
    },
  });

  if (!session || session.expiresAt < new Date()) {
    if (session) {
      await deleteSession(sessionToken);
    }
    return null;
  }

  return session.user;
}
