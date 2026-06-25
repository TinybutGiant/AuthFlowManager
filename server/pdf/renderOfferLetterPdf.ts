import PDFDocument from "pdfkit";
import type { AdminEngagement, AdminEngagementDocument, AdminUser } from "@shared/schema";
import {
  parseOfferLetterPlainText,
  stripLegacyOfferLetterTextHeader,
  type OfferLetterPlainTextBlock,
} from "@shared/offerLetterPlainTextParser";

export const OFFER_LETTER_PDF_TYPOGRAPHY = {
  PAGE_SIZE: "LETTER",
  PAGE_MARGIN: 52,
  BODY_FONT: "Helvetica",
  BODY_FONT_SIZE: 10.75,
  BODY_LINE_GAP: 3.5,
  TITLE_FONT: "Helvetica-Bold",
  TITLE_FONT_SIZE: 14.5,
  SECTION_FONT: "Helvetica-Bold",
  SECTION_FONT_SIZE: 11.5,
  PARAGRAPH_GAP: 7,
  LIST_INDENT: 18,
  LIST_BULLET_WIDTH: 12,
  LIST_ITEM_GAP: 4,
} as const;

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
  brand?: {
    companyName: string;
    workLocation?: string | null;
  } | null;
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

function contentWidth(doc: PDFKit.PDFDocument) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function ensureRemainingSpace(doc: PDFKit.PDFDocument, minHeight: number) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + minHeight > bottom) {
    doc.addPage();
  }
}

function addVerticalGap(doc: PDFKit.PDFDocument, gap: number = OFFER_LETTER_PDF_TYPOGRAPHY.PARAGRAPH_GAP) {
  doc.y += gap;
}

function renderLetterhead(doc: PDFKit.PDFDocument, input: OfferLetterPdfInput) {
  if (input.brandLogo?.assetPath) {
    try {
      doc.image(input.brandLogo.assetPath, doc.page.margins.left, doc.y, { fit: [120, 48] });
      doc.y += 54;
    } catch {
      console.warn("[offer-letter-pdf] Company logo could not be rendered; omitting logo.", {
        version: input.brandLogo.version,
      });
    }
  }

  if (!input.brand?.companyName) {
    return;
  }

  doc
    .font(OFFER_LETTER_PDF_TYPOGRAPHY.SECTION_FONT)
    .fontSize(11.5)
    .fillColor("#111827")
    .text(input.brand.companyName, { align: "center", width: contentWidth(doc) });

  if (input.brand.workLocation) {
    doc
      .font(OFFER_LETTER_PDF_TYPOGRAPHY.BODY_FONT)
      .fontSize(9.5)
      .fillColor("#4b5563")
      .text(input.brand.workLocation, { align: "center", width: contentWidth(doc) });
  }

  doc
    .strokeColor("#d1d5db")
    .moveTo(doc.page.margins.left, doc.y + 10)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y + 10)
    .stroke();
  doc.fillColor("#111827");
  doc.y += 28;
}

function renderParagraph(doc: PDFKit.PDFDocument, text: string) {
  ensureRemainingSpace(doc, 32);
  doc
    .font(OFFER_LETTER_PDF_TYPOGRAPHY.BODY_FONT)
    .fontSize(OFFER_LETTER_PDF_TYPOGRAPHY.BODY_FONT_SIZE)
    .fillColor("#111827")
    .text(text, {
      align: "left",
      lineGap: OFFER_LETTER_PDF_TYPOGRAPHY.BODY_LINE_GAP,
      width: contentWidth(doc),
    });
  addVerticalGap(doc);
}

function renderSectionHeading(
  doc: PDFKit.PDFDocument,
  block: Extract<OfferLetterPlainTextBlock, { type: "sectionHeading" }>,
) {
  ensureRemainingSpace(doc, 46);
  doc.y += 4;
  doc
    .font(OFFER_LETTER_PDF_TYPOGRAPHY.SECTION_FONT)
    .fontSize(OFFER_LETTER_PDF_TYPOGRAPHY.SECTION_FONT_SIZE)
    .fillColor("#111827")
    .text(`${block.marker ? `${block.marker}. ` : ""}${block.text}`, {
      width: contentWidth(doc),
      lineGap: 1.5,
    });
  doc.y += 5;
}

function renderListItem(doc: PDFKit.PDFDocument, marker: string, text: string) {
  ensureRemainingSpace(doc, 28);
  const markerX = doc.page.margins.left;
  const textX = markerX + OFFER_LETTER_PDF_TYPOGRAPHY.LIST_INDENT;
  const startY = doc.y;
  const textWidth = doc.page.width - doc.page.margins.right - textX;

  doc
    .font(OFFER_LETTER_PDF_TYPOGRAPHY.BODY_FONT)
    .fontSize(OFFER_LETTER_PDF_TYPOGRAPHY.BODY_FONT_SIZE)
    .fillColor("#111827")
    .text(marker, markerX, startY, {
      width: OFFER_LETTER_PDF_TYPOGRAPHY.LIST_BULLET_WIDTH,
      lineBreak: false,
    });
  doc
    .font(OFFER_LETTER_PDF_TYPOGRAPHY.BODY_FONT)
    .fontSize(OFFER_LETTER_PDF_TYPOGRAPHY.BODY_FONT_SIZE)
    .text(text, textX, startY, {
      width: textWidth,
      lineGap: OFFER_LETTER_PDF_TYPOGRAPHY.BODY_LINE_GAP,
    });
  doc.y += OFFER_LETTER_PDF_TYPOGRAPHY.LIST_ITEM_GAP;
}

function renderBlock(doc: PDFKit.PDFDocument, block: OfferLetterPlainTextBlock) {
  switch (block.type) {
    case "blankLine":
      doc.y += 4;
      return;
    case "sectionHeading":
      renderSectionHeading(doc, block);
      return;
    case "bulletList":
      doc.y += 2;
      for (const item of block.items) {
        renderListItem(doc, "•", item);
      }
      addVerticalGap(doc, 3);
      return;
    case "numberedList":
      doc.y += 2;
      for (const item of block.items) {
        renderListItem(doc, `${item.marker}.`, item.text);
      }
      addVerticalGap(doc, 3);
      return;
    case "signatureBlock":
      ensureRemainingSpace(doc, 90);
      doc.y += 18;
      block.lines.forEach((line, index) => {
        doc
          .font(OFFER_LETTER_PDF_TYPOGRAPHY.BODY_FONT)
          .fontSize(OFFER_LETTER_PDF_TYPOGRAPHY.BODY_FONT_SIZE)
          .fillColor("#111827")
          .text(line, {
            width: contentWidth(doc),
            lineGap: OFFER_LETTER_PDF_TYPOGRAPHY.BODY_LINE_GAP,
          });
        if (index === 0) {
          doc.y += 20;
        }
      });
      addVerticalGap(doc, 5);
      return;
    case "acknowledgmentBlock":
      ensureRemainingSpace(doc, 90);
      doc.y += 12;
      doc
        .strokeColor("#d1d5db")
        .moveTo(doc.page.margins.left, doc.y)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .stroke();
      doc.y += 12;
      block.lines.forEach((line, index) => {
        doc
          .font(index === 0 ? OFFER_LETTER_PDF_TYPOGRAPHY.SECTION_FONT : OFFER_LETTER_PDF_TYPOGRAPHY.BODY_FONT)
          .fontSize(OFFER_LETTER_PDF_TYPOGRAPHY.BODY_FONT_SIZE)
          .fillColor("#111827")
          .text(line, {
            width: contentWidth(doc),
            lineGap: OFFER_LETTER_PDF_TYPOGRAPHY.BODY_LINE_GAP,
          });
        if (index === 0) {
          doc.y += 4;
        }
      });
      return;
    case "paragraph":
    default:
      renderParagraph(doc, block.text);
  }
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
    margin: OFFER_LETTER_PDF_TYPOGRAPHY.PAGE_MARGIN,
    size: OFFER_LETTER_PDF_TYPOGRAPHY.PAGE_SIZE,
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

  renderLetterhead(doc, input);
  doc
    .font(OFFER_LETTER_PDF_TYPOGRAPHY.TITLE_FONT)
    .fontSize(OFFER_LETTER_PDF_TYPOGRAPHY.TITLE_FONT_SIZE)
    .fillColor("#111827")
    .text(input.document.title, {
      align: "center",
      width: contentWidth(doc),
    });
  doc.y += 18;

  const bodyText = stripLegacyOfferLetterTextHeader(input.document.body, {
    companyName: input.brand?.companyName,
    workLocation: input.brand?.workLocation,
  });
  for (const block of parseOfferLetterPlainText(bodyText)) {
    renderBlock(doc, block);
  }

  doc.end();
  return finished;
}
