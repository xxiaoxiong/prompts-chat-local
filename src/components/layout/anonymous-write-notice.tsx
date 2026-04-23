import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface AnonymousWriteNoticeProps {
  className?: string;
}

export function AnonymousWriteNotice({ className }: AnonymousWriteNoticeProps) {
  return (
    <Alert className={className}>
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription>
        当前为内网匿名协作模式，所有访问者均可新增、编辑和删除 prompts / skills。
      </AlertDescription>
    </Alert>
  );
}
