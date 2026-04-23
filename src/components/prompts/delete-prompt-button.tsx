"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface DeletePromptButtonProps {
  promptId: string;
  redirectTo?: string;
  variant?: "destructive" | "outline" | "ghost";
  size?: "sm" | "default" | "lg" | "icon";
  className?: string;
}

export function DeletePromptButton({
  promptId,
  redirectTo = "/prompts",
  variant = "destructive",
  size = "sm",
  className,
}: DeletePromptButtonProps) {
  const router = useRouter();
  const t = useTranslations("prompts");
  const tCommon = useTranslations("common");
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);

    try {
      const response = await fetch(`/api/prompts/${promptId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        toast.success(t("deletePrompt"));
        router.push(redirectTo);
        router.refresh();
        return;
      }

      const data = await response.json().catch(() => null);
      toast.error(data?.message || data?.error || t("deleteError"));
    } catch {
      toast.error(t("deleteError"));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant={variant} size={size} className={className} disabled={isDeleting}>
          {isDeleting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
          {size !== "icon" && <span className="ml-2">{t("deletePrompt")}</span>}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("deletePromptTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("deletePromptDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>{tCommon("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={isDeleting}
            className="bg-destructive hover:bg-destructive/90 text-white"
          >
            {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : tCommon("delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
