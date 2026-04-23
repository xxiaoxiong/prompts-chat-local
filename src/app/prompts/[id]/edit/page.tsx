import { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { PromptForm } from "@/components/prompts/prompt-form";
import { DeletePromptButton } from "@/components/prompts/delete-prompt-button";
import { isAIGenerationEnabled, getAIModelName } from "@/lib/ai/generation";
import { AnonymousWriteNotice } from "@/components/layout/anonymous-write-notice";

interface EditPromptPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Extracts the prompt ID from a URL parameter that may contain a slug
 */
function extractPromptId(idParam: string): string {
  const underscoreIndex = idParam.indexOf("_");
  if (underscoreIndex !== -1) {
    return idParam.substring(0, underscoreIndex);
  }
  return idParam;
}

export const metadata: Metadata = {
  title: "Edit Prompt",
  description: "Edit your prompt",
};

export default async function EditPromptPage({ params }: EditPromptPageProps) {
  const { id: idParam } = await params;
  const id = extractPromptId(idParam);
  const session = await auth();
  const config = await getConfig();
  const anonymousWriteEnabled = config.features.allowAnonymousWrite === true;
  const t = await getTranslations("prompts");

  if (!session?.user && !anonymousWriteEnabled) {
    redirect("/login");
  }

  // Fetch the prompt
  const prompt = await db.prompt.findUnique({
    where: { id },
    include: {
      tags: {
        include: {
          tag: true,
        },
      },
      contributors: {
        select: {
          id: true,
          username: true,
          name: true,
          avatar: true,
        },
      },
    },
  });

  if (!prompt) {
    notFound();
  }

  // Check if user is the author or admin
  const isAuthor = prompt.authorId === session?.user?.id;
  const isAdmin = session?.user?.role === "ADMIN";
  
  if (!anonymousWriteEnabled && !isAuthor && !isAdmin) {
    redirect(`/prompts/${id}`);
  }

  // Fetch categories and tags for the form
  const [categories, tags] = await Promise.all([
    db.category.findMany({
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        parentId: true,
      },
    }),
    db.tag.findMany({ orderBy: { name: "asc" } }),
  ]);

  // Transform prompt data for the form
  const initialData = {
    title: prompt.title,
    description: prompt.description || "",
    content: prompt.content,
    type: ((prompt.type === "IMAGE" || prompt.type === "VIDEO" || prompt.type === "AUDIO" || prompt.type === "SKILL" || prompt.type === "TASTE") ? prompt.type : "TEXT") as "TEXT" | "IMAGE" | "VIDEO" | "AUDIO" | "SKILL" | "TASTE",
    structuredFormat: prompt.structuredFormat ? (prompt.structuredFormat as "JSON" | "YAML") : undefined,
    categoryId: prompt.categoryId || undefined,
    tagIds: prompt.tags.map((t) => t.tagId),
    isPrivate: prompt.isPrivate,
    mediaUrl: prompt.mediaUrl || "",
    requiresMediaUpload: prompt.requiresMediaUpload,
    requiredMediaType: (prompt.requiredMediaType as "IMAGE" | "VIDEO" | "DOCUMENT") || "IMAGE",
    requiredMediaCount: prompt.requiredMediaCount || 1,
    bestWithModels: (prompt as unknown as { bestWithModels?: string[] }).bestWithModels || [],
    bestWithMCP: (prompt as unknown as { bestWithMCP?: { command: string; tools?: string[] }[] }).bestWithMCP || [],
    workflowLink: (prompt as unknown as { workflowLink?: string }).workflowLink || "",
  };

  // Check if AI generation is enabled
  const aiGenerationEnabled = await isAIGenerationEnabled();
  const aiModelName = getAIModelName();

  return (
    <div className="container max-w-3xl py-8 space-y-6">
      {anonymousWriteEnabled && <AnonymousWriteNotice className="mb-6" />}
      <PromptForm
        categories={categories}
        tags={tags}
        initialData={initialData}
        initialContributors={prompt.contributors}
        promptId={id}
        mode="edit"
        aiGenerationEnabled={aiGenerationEnabled}
        aiModelName={aiModelName}
      />
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-destructive">{t("deletePrompt")}</h2>
            <p className="text-sm text-muted-foreground">{t("deletePromptDescription")}</p>
          </div>
          <DeletePromptButton promptId={id} redirectTo="/prompts" />
        </div>
      </div>
    </div>
  );
}
