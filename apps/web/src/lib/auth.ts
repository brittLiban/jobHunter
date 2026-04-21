import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import { createCredentialUser, createSession, deleteSession, getSessionUser, getUserByEmail } from "@jobhunter/db";
import type { SignupInput } from "@jobhunter/core";
import type { Route } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const SESSION_COOKIE = "jobhunter_session";
const SESSION_AGE_MS = 1000 * 60 * 60 * 24 * 14;
const LOGIN_ROUTE = "/login" as Route;
const ONBOARDING_ROUTE = "/onboarding" as Route;

export async function getOptionalCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) {
    return null;
  }
  return getSessionUser(token);
}

export async function requireCurrentUser() {
  const user = await getOptionalCurrentUser();
  if (!user) {
    redirect(LOGIN_ROUTE);
  }
  return user;
}

export async function requireOnboardedUser() {
  const user = await requireCurrentUser();
  if (!user.onboardingCompletedAt) {
    redirect(ONBOARDING_ROUTE);
  }
  return user;
}

export async function signUpUser(input: SignupInput) {
  const existing = await getUserByEmail(input.email);
  if (existing) {
    throw new Error("An account already exists for this email.");
  }
  const passwordHash = hashPassword(input.password);
  const user = await createCredentialUser({
    ...input,
    passwordHash,
  });
  await createUserSession(user.id);
  return user;
}

export async function logInUser(email: string, password: string) {
  const user = await getUserByEmail(email);
  if (!user?.passwordHash) {
    throw new Error("Invalid email or password.");
  }
  if (!verifyPassword(password, user.passwordHash)) {
    throw new Error("Invalid email or password.");
  }
  await createUserSession(user.id);
  return user;
}

export async function logOutUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await deleteSession(token);
  }
  cookieStore.delete(SESSION_COOKIE);
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const digest = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${digest}`;
}

function verifyPassword(password: string, stored: string) {
  const [salt, digest] = stored.split(":");
  if (!salt || !digest) {
    return false;
  }
  const candidate = scryptSync(password, salt, 64);
  const target = Buffer.from(digest, "hex");
  if (candidate.length !== target.length) {
    return false;
  }
  return timingSafeEqual(candidate, target);
}

async function createUserSession(userId: string) {
  const sessionToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_AGE_MS);
  await createSession(userId, sessionToken, expiresAt);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  });
}
