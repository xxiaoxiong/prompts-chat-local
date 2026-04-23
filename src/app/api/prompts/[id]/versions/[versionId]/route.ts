import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAnonymousWriteEnabled, requireUserOrAnonymous } from "@/lib/anonymous-write";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  try {
    const { actor, unauthorizedResponse } = await requireUserOrAnonymous();
    if (!actor) {
      return unauthorizedResponse;
    }

    const { id: promptId, versionId } = await params;

    // Check if prompt exists and user is owner
    const prompt = await db.prompt.findUnique({
      where: { id: promptId },
      select: { authorId: true },
    });

    if (!prompt) {
      return NextResponse.json(
        { error: "not_found", message: "Prompt not found" },
        { status: 404 }
      );
    }

    const anonymousWriteEnabled = await isAnonymousWriteEnabled();
    if (!anonymousWriteEnabled && prompt.authorId !== actor.id) {
      return NextResponse.json(
        { error: "forbidden", message: "You can only delete versions of your own prompts" },
        { status: 403 }
      );
    }

    // Check if version exists
    const version = await db.promptVersion.findUnique({
      where: { id: versionId },
      select: { id: true, promptId: true },
    });

    if (!version || version.promptId !== promptId) {
      return NextResponse.json(
        { error: "not_found", message: "Version not found" },
        { status: 404 }
      );
    }

    // Delete the version
    await db.promptVersion.delete({
      where: { id: versionId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete version error:", error);
    return NextResponse.json(
      { error: "server_error", message: "Something went wrong" },
      { status: 500 }
    );
  }
}
