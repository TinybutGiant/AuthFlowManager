import PDFDocument from "pdfkit";
import type { AdminEngagement, AdminEngagementDocument, AdminUser } from "@shared/schema";

export const REQUIRED_SNAPSHOT_PDF_MERGE_KEYS = [
  "trainee_name",
  "trainee_email",
  "engagement_type",
  "schedule_text",
  "start_date",
  "end_date",
  "expected_hours_per_week",
  "work_scope",
  "work_authorization_type",
  "supervisor_name",
  "supervisor_email",
  "company_name",
] as const;

export class OfferLetterSnapshotDataError extends Error {
  constructor(public readonly missingKeys: string[]) {
    super("Offer letter snapshot is incomplete.");
    this.name = "OfferLetterSnapshotDataError";
  }
}

export interface OfferLetterPdfContext {
  traineeName: string;
  traineeEmail: string;
  engagementType: string;
  scheduleText: string;
  startDate: string;
  endDate: string;
  expectedHoursPerWeek: string;
  workAuthorizationType: string;
  supervisorName: string;
  supervisorEmail: string;
}

export interface OfferLetterPdfInput {
  document: Pick<AdminEngagementDocument, "title" | "body" | "version">;
  context: OfferLetterPdfContext;
  brandLogo?: {
    assetPath: string;
    altText: string;
    version: string;
  } | null;
  generatedAt?: Date;
}

function dateOnly(value: string | Date | null | undefined) {
  if (!value) {
    return "Not set";
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function valueOrFallback(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "Not set";
  }
  return String(value).replace(/_/g, " ");
}

function addLabelValue(doc: PDFKit.PDFDocument, label: string, value: string) {
  doc.font("Helvetica-Bold").text(`${label}: `, { continued: true });
  doc.font("Helvetica").text(value);
}

function mergeValue(mergeData: unknown, key: string): string | null {
  if (!mergeData || typeof mergeData !== "object" || Array.isArray(mergeData)) {
    return null;
  }
  const value = (mergeData as Record<string, unknown>)[key];
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }
  return String(value);
}

export function buildLegacyOfferLetterPdfContext(input: {
  engagement: AdminEngagement;
  trainee: AdminUser;
  supervisor?: AdminUser | null;
}): OfferLetterPdfContext {
  return {
    traineeName: input.trainee.name,
    traineeEmail: input.trainee.email,
    engagementType: valueOrFallback(input.engagement.engagementType),
    scheduleText: valueOrFallback(input.engagement.scheduleType),
    startDate: dateOnly(input.engagement.startDate),
    endDate: dateOnly(input.engagement.endDate),
    expectedHoursPerWeek: valueOrFallback(input.engagement.expectedHoursPerWeek),
    workAuthorizationType: valueOrFallback(input.engagement.workAuthorizationType),
    supervisorName: input.supervisor ? input.supervisor.name : "Not set",
    supervisorEmail: input.supervisor ? input.supervisor.email : "Not set",
  };
}

export function buildSnapshotOfferLetterPdfContext(mergeData: unknown): OfferLetterPdfContext {
  const missingKeys = REQUIRED_SNAPSHOT_PDF_MERGE_KEYS.filter((key) => !mergeValue(mergeData, key));
  if (missingKeys.length > 0) {
    throw new OfferLetterSnapshotDataError(missingKeys);
  }

  return {
    traineeName: mergeValue(mergeData, "trainee_name")!,
    traineeEmail: mergeValue(mergeData, "trainee_email")!,
    engagementType: mergeValue(mergeData, "engagement_type")!,
    scheduleText: mergeValue(mergeData, "schedule_text")!,
    startDate: mergeValue(mergeData, "start_date")!,
    endDate: mergeValue(mergeData, "end_date")!,
    expectedHoursPerWeek: mergeValue(mergeData, "expected_hours_per_week")!,
    workAuthorizationType: mergeValue(mergeData, "work_authorization_type")!,
    supervisorName: mergeValue(mergeData, "supervisor_name")!,
    supervisorEmail: mergeValue(mergeData, "supervisor_email")!,
  };
}

export async function renderOfferLetterPdfBuffer(input: OfferLetterPdfInput): Promise<Buffer> {
  const generatedAt = input.generatedAt ?? new Date();
  const chunks: Buffer[] = [];
  const doc = new PDFDocument({
    margin: 56,
    size: "LETTER",
    info: {
      Title: input.document.title,
      Author: "YaoTu Admin",
      Subject: "Trainee Offer Letter",
      CreationDate: generatedAt,
    },
  });

  doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));

  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  if (input.brandLogo?.assetPath) {
    try {
      doc.image(input.brandLogo.assetPath, doc.page.margins.left, doc.y, { fit: [120, 48] });
      doc.moveDown(0.75);
    } catch {
      console.warn("[offer-letter-pdf] Company logo could not be rendered; omitting logo.", {
        version: input.brandLogo.version,
      });
    }
  }

  doc.font("Helvetica-Bold").fontSize(18).text(input.document.title, { align: "center" });
  doc.moveDown(0.5);
  doc.font("Helvetica").fontSize(9).fillColor("#555555").text(
    `Version ${input.document.version} | Generated ${generatedAt.toISOString()}`,
    { align: "center" },
  );
  doc.fillColor("#000000").moveDown(1.5);

  doc.font("Helvetica-Bold").fontSize(12).text("Trainee");
  doc.moveDown(0.25);
  doc.fontSize(10);
  addLabelValue(doc, "Name", input.context.traineeName);
  addLabelValue(doc, "Email", input.context.traineeEmail);
  doc.moveDown();

  doc.font("Helvetica-Bold").fontSize(12).text("Engagement");
  doc.moveDown(0.25);
  doc.fontSize(10);
  addLabelValue(doc, "Type", input.context.engagementType);
  addLabelValue(doc, "Schedule", input.context.scheduleText);
  addLabelValue(doc, "Start Date", input.context.startDate);
  addLabelValue(doc, "End Date", input.context.endDate);
  addLabelValue(doc, "Expected Hours Per Week", input.context.expectedHoursPerWeek);
  addLabelValue(doc, "Work Authorization", input.context.workAuthorizationType);
  addLabelValue(
    doc,
    "Supervisor",
    `${input.context.supervisorName} (${input.context.supervisorEmail})`,
  );
  doc.moveDown();

  doc.font("Helvetica-Bold").fontSize(12).text("Offer Letter");
  doc.moveDown(0.5);
  doc.font("Helvetica").fontSize(10).text(input.document.body, {
    align: "left",
    lineGap: 4,
  });

  doc.moveDown(2);
  doc.fontSize(9).fillColor("#555555").text(
    "Acceptance is recorded in the YaoTu trainee workspace after authenticated review.",
  );

  doc.end();
  return finished;
}
