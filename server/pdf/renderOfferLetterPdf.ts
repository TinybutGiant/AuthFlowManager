import PDFDocument from "pdfkit";
import type { AdminEngagement, AdminEngagementDocument, AdminUser } from "@shared/schema";

export interface OfferLetterPdfInput {
  document: Pick<AdminEngagementDocument, "title" | "body" | "version">;
  engagement: AdminEngagement;
  trainee: AdminUser;
  supervisor?: AdminUser | null;
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
  addLabelValue(doc, "Name", input.trainee.name);
  addLabelValue(doc, "Email", input.trainee.email);
  doc.moveDown();

  doc.font("Helvetica-Bold").fontSize(12).text("Engagement");
  doc.moveDown(0.25);
  doc.fontSize(10);
  addLabelValue(doc, "Type", valueOrFallback(input.engagement.engagementType));
  addLabelValue(doc, "Schedule", valueOrFallback(input.engagement.scheduleType));
  addLabelValue(doc, "Start Date", dateOnly(input.engagement.startDate));
  addLabelValue(doc, "End Date", dateOnly(input.engagement.endDate));
  addLabelValue(doc, "Expected Hours Per Week", valueOrFallback(input.engagement.expectedHoursPerWeek));
  addLabelValue(doc, "Supervisor", input.supervisor ? `${input.supervisor.name} (${input.supervisor.email})` : "Not set");
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
