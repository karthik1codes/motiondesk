import { Suspense } from "react";
import { SequenceEditor } from "@/components/SequenceEditor";

export default function EditorPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-muted-foreground">
          Opening sequence editor…
        </div>
      }
    >
      <SequenceEditor />
    </Suspense>
  );
}
