import { auth } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";

export const ANONYMOUS_USER_ID = "local-anonymous";
export const ANONYMOUS_USERNAME = "local-anonymous";
export const ANONYMOUS_EMAIL = "local-anonymous@intranet.local";
export const ANONYMOUS_NAME = "Intranet User";

export interface EffectiveActor {
  id: string;
  role: string;
  username: string;
  email: string;
  name: string;
  image: string | null;
  isAnonymous: boolean;
}

export async function isAnonymousWriteEnabled(): Promise<boolean> {
  const config = await getConfig();
  return config.features.allowAnonymousWrite === true;
}

export async function ensureAnonymousUser() {
  return db.user.upsert({
    where: { id: ANONYMOUS_USER_ID },
    update: {
      email: ANONYMOUS_EMAIL,
      username: ANONYMOUS_USERNAME,
      name: ANONYMOUS_NAME,
      password: null,
      avatar: null,
    },
    create: {
      id: ANONYMOUS_USER_ID,
      email: ANONYMOUS_EMAIL,
      username: ANONYMOUS_USERNAME,
      name: ANONYMOUS_NAME,
      password: null,
      avatar: null,
      role: "USER",
      locale: "en",
      verified: false,
    },
  });
}

export async function getAnonymousActor(): Promise<EffectiveActor> {
  const user = await ensureAnonymousUser();

  return {
    id: user.id,
    role: user.role,
    username: user.username,
    email: user.email,
    name: user.name || ANONYMOUS_NAME,
    image: user.avatar,
    isAnonymous: true,
  };
}

export async function getEffectiveActor(): Promise<EffectiveActor | null> {
  const session = await auth();

  if (session?.user) {
    return {
      id: session.user.id,
      role: session.user.role,
      username: session.user.username,
      email: session.user.email,
      name: session.user.name || session.user.username,
      image: session.user.image || null,
      isAnonymous: false,
    };
  }

  if (await isAnonymousWriteEnabled()) {
    return getAnonymousActor();
  }

  return null;
}

export async function requireUserOrAnonymous() {
  const actor = await getEffectiveActor();

  if (!actor) {
    return {
      actor: null,
      unauthorizedResponse: Response.json(
        { error: "unauthorized", message: "You must be logged in" },
        { status: 401 }
      ),
    };
  }

  return {
    actor,
    unauthorizedResponse: null,
  };
}

export async function canWriteInCurrentMode() {
  return !!(await getEffectiveActor());
}
