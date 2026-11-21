import { downloadDocx } from "../topics/downloadDocx";

export type PlanDocKind = "plan" | "schedule";

export async function downloadPlanDocx(input: {
  kind?: PlanDocKind;
  projectTitle: string;
  documentLabel?: string;
  documentType?: string;
  plan: any;
  materials?: { id: string; title?: string; type?: string }[];
}) {
  const response = await fetch("/api/research/plan-docx", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: input.kind || "plan",
      projectTitle: input.projectTitle,
      documentLabel: input.documentLabel,
      documentType: input.documentType,
      plan: input.plan,
      materials: input.materials,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "Export impossible.");
  downloadDocx(data.file.base64, data.file.filename);
}
