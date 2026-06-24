import crypto from "node:crypto";
import type {
  AdminEngagement,
  AdminEngagementDocument,
  AdminUser,
  InsertAdminEngagementDocument,
} from "@shared/schema";
import type { IStorage } from "./storage";
import { buildPasswordSetupUrl, createPasswordSetupToken, getAdminAppOrigin } from "./passwordSetup";
import {
  buildLegacyOfferLetterPdfContext,
  buildSnapshotOfferLetterPdfContext,
  OfferLetterSnapshotDataError,
  renderOfferLetterPdfBuffer,
} from "./pdf/renderOfferLetterPdf";
import {
  getPrivateObjectBuffer,
  isPrivateObjectStorageConfigured,
  privateObjectExists,
  putPrivateObject,
  type PrivateObjectBuffer,
  type PutPrivateObjectInput,
} from "./lib/privateR2Storage";
import { sendOfferLetterReadyEmail, sendTraineeOfferSetupEmail } from "./email";
import {
  previewOfferLetterTemplate,
  type ManualOfferLetterMergeValues,
} from "./documentTemplateService";

const PRIVATE_STORAGE_NOT_CONFIGURED_MESSAGE = "Private offer letter storage is not configured.";
const PREPARE_OFFER_LETTER_ERROR_MESSAGE = "Could not prepare the offer letter document.";
const OFFER_LETTER_SNAPSHOT_INCOMPLETE_MESSAGE =
  "Offer letter snapshot is incomplete. Please create a new offer letter version.";
const OFFER_LETTER_ARTIFACT_UNAVAILABLE_MESSAGE =
  "Document artifact is not available. Please try again or regenerate the offer letter.";

export class OfferLetterError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "OfferLetterError";
  }
}

export interface OfferLetterObjectStorage {
  isConfigured(): boolean;
  putPrivateObject(input: PutPrivateObjectInput): Promise<void>;
  privateObjectExists(key: string): Promise<boolean>;
  getPrivateObjectBuffer(key: string): Promise<PrivateObjectBuffer>;
}

export interface OfferLetterEmailSender {
  (input: { to: string; name: string; workspaceUrl: string; title: string }): Promise<boolean>;
}

export interface OfferLetterSetupEmailSender {
  (input: { to: string; name: string; setupUrl: string; workspaceUrl: string; title: string }): Promise<boolean>;
}

export const defaultOfferLetterObjectStorage: OfferLetterObjectStorage = {
  isConfigured: isPrivateObjectStorageConfigured,
  putPrivateObject,
  privateObjectExists,
  getPrivateObjectBuffer,
};

function logOfferLetterStorageError(context: string, error: unknown) {
  console.error(`[offer-letter] ${context}`, error);
}

function assertPrivateStorageConfigured(objectStorage: OfferLetterObjectStorage) {
  if (!objectStorage.isConfigured()) {
    throw new OfferLetterError(
      503,
      PRIVATE_STORAGE_NOT_CONFIGURED_MESSAGE,
    );
  }
}

function sha256(buffer: Buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function offerLetterKey(document: Pick<AdminEngagementDocument, "id" | "engagementId" | "version">) {
  return `engagement-documents/${document.engagementId}/${document.id}/v${document.version}/offer-letter.pdf`;
}

function safeLifecycleMetadata(document: AdminEngagementDocument, extra: Record<string, unknown> = {}) {
  return {
    ...extra,
    document_id: document.id,
    document_type: document.documentType,
    document_version: document.version,
    document_status: document.status,
  };
}

function hasMergeSnapshot(document: Pick<AdminEngagementDocument, "mergeData">) {
  return Boolean(document.mergeData);
}

function metadataValue(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }
  return (metadata as Record<string, unknown>)[key];
}

function isPasswordSetupInvitationEvent(event: { eventType?: string; metadata?: unknown }) {
  if (event.eventType !== "invitation_sent") {
    return false;
  }
  const purpose = metadataValue(event.metadata, "purpose");
  return (
    purpose === "password_setup" ||
    purpose === "password_setup_resend" ||
    purpose === "trainee_offer_setup"
  );
}

async function getEngagementContext(
  serviceStorage: IStorage,
  engagementId: number
): Promise<{ engagement: AdminEngagement; trainee: AdminUser; supervisor?: AdminUser }> {
  const engagement = await serviceStorage.getAdminEngagement(engagementId);
  if (!engagement) {
    throw new OfferLetterError(404, "Admin engagement not found");
  }

  const trainee = await serviceStorage.getAdminUser(engagement.adminUserId);
  if (!trainee) {
    throw new OfferLetterError(404, "Trainee admin user not found");
  }
  if (trainee.role !== "trainee_access") {
    throw new OfferLetterError(400, "Offer letters can be created only for trainee engagements");
  }

  const supervisor = engagement.supervisorAdminId
    ? await serviceStorage.getAdminUser(engagement.supervisorAdminId)
    : undefined;

  return { engagement, trainee, supervisor };
}

export async function generateOfferLetterPdfArtifact(input: {
  storage: IStorage;
  objectStorage?: OfferLetterObjectStorage;
  document: AdminEngagementDocument;
  actorAdminId: number | null;
  reason: "created" | "regenerated" | "send_missing_pdf";
  now?: Date;
}): Promise<AdminEngagementDocument> {
  const objectStorage = input.objectStorage ?? defaultOfferLetterObjectStorage;
  if (input.document.status === "voided") {
    throw new OfferLetterError(409, "Voided offer letters cannot be regenerated");
  }
  if (input.document.status === "accepted") {
    throw new OfferLetterError(409, "Accepted offer letters cannot be regenerated");
  }
  assertPrivateStorageConfigured(objectStorage);

  const now = input.now ?? new Date();
  let pdf: Buffer;
  try {
    const context = hasMergeSnapshot(input.document)
      ? buildSnapshotOfferLetterPdfContext(input.document.mergeData)
      : buildLegacyOfferLetterPdfContext(
          await getEngagementContext(input.storage, input.document.engagementId),
        );
    pdf = await renderOfferLetterPdfBuffer({
      document: input.document,
      context,
      generatedAt: now,
    });
  } catch (error) {
    if (error instanceof OfferLetterSnapshotDataError) {
      throw new OfferLetterError(409, OFFER_LETTER_SNAPSHOT_INCOMPLETE_MESSAGE);
    }
    logOfferLetterStorageError("Failed to render offer letter PDF artifact.", error);
    throw new OfferLetterError(503, PREPARE_OFFER_LETTER_ERROR_MESSAGE);
  }
  const fileKey = offerLetterKey(input.document);
  const fileSha256 = sha256(pdf);

  try {
    await objectStorage.putPrivateObject({
      buffer: pdf,
      key: fileKey,
      contentType: "application/pdf",
      metadata: {
        document_id: input.document.id,
        engagement_id: input.document.engagementId,
        document_type: input.document.documentType,
        version: input.document.version,
        sha256: fileSha256,
      },
    });
  } catch (error) {
    logOfferLetterStorageError("Failed to upload offer letter PDF artifact.", error);
    throw new OfferLetterError(503, PREPARE_OFFER_LETTER_ERROR_MESSAGE);
  }

  const updated = await input.storage.updateAdminEngagementDocumentWithEvent(
    input.document.id,
    {
      fileKey,
      fileSha256,
      fileContentType: "application/pdf",
      fileSizeBytes: pdf.byteLength,
    },
    {
      eventType: "offer_letter_pdf_generated",
      actorAdminId: input.actorAdminId,
      metadata: safeLifecycleMetadata(input.document, { reason: input.reason }),
      notes: null,
    },
  );

  if (!updated) {
    throw new OfferLetterError(404, "Offer letter document not found");
  }

  return updated;
}

export async function createOfferLetterDocument(input: {
  storage: IStorage;
  objectStorage?: OfferLetterObjectStorage;
  engagementId: number;
  actorAdminId: number;
  title: string;
  body: string;
  now?: Date;
}): Promise<AdminEngagementDocument> {
  return createFrozenOfferLetterDocument({
    storage: input.storage,
    objectStorage: input.objectStorage,
    engagementId: input.engagementId,
    actorAdminId: input.actorAdminId,
    title: input.title,
    body: input.body,
    now: input.now,
  });
}

export async function createOfferLetterDocumentFromTemplate(input: {
  storage: IStorage;
  objectStorage?: OfferLetterObjectStorage;
  engagementId: number;
  actorAdminId: number;
  templateId: number;
  manualValues: ManualOfferLetterMergeValues;
  title?: string;
  body?: string;
  now?: Date;
}): Promise<AdminEngagementDocument> {
  const preview = await previewOfferLetterTemplate({
    storage: input.storage,
    engagementId: input.engagementId,
    templateId: input.templateId,
    manualValues: input.manualValues,
  });

  return createFrozenOfferLetterDocument({
    storage: input.storage,
    objectStorage: input.objectStorage,
    engagementId: input.engagementId,
    actorAdminId: input.actorAdminId,
    title: input.title ?? preview.title,
    body: input.body ?? preview.body,
    templateSnapshot: {
      templateId: preview.template.id,
      templateVersion: preview.template.version,
      templateNameSnapshot: preview.template.name,
      templateTitleSnapshot: preview.template.titleTemplate,
      templateBodySnapshot: preview.template.bodyTemplate,
      mergeData: preview.mergeData,
      contentFormat: preview.template.contentFormat,
    },
    now: input.now,
  });
}

interface OfferLetterTemplateSnapshotInput {
  templateId: number;
  templateVersion: number;
  templateNameSnapshot: string;
  templateTitleSnapshot: string;
  templateBodySnapshot: string;
  mergeData: unknown;
  contentFormat: string;
}

function assertFinalOfferLetterContent(title: string, body: string) {
  if (!title.trim() || title.length > 200) {
    throw new OfferLetterError(400, "Title is required and must be 200 characters or fewer");
  }
  if (!body.trim() || body.length > 20000) {
    throw new OfferLetterError(400, "Body is required and must be 20000 characters or fewer");
  }
}

async function createFrozenOfferLetterDocument(input: {
  storage: IStorage;
  objectStorage?: OfferLetterObjectStorage;
  engagementId: number;
  actorAdminId: number;
  title: string;
  body: string;
  templateSnapshot?: OfferLetterTemplateSnapshotInput;
  now?: Date;
}): Promise<AdminEngagementDocument> {
  const objectStorage = input.objectStorage ?? defaultOfferLetterObjectStorage;
  assertPrivateStorageConfigured(objectStorage);
  assertFinalOfferLetterContent(input.title, input.body);
  if (input.templateSnapshot) {
    try {
      buildSnapshotOfferLetterPdfContext(input.templateSnapshot.mergeData);
    } catch (error) {
      if (error instanceof OfferLetterSnapshotDataError) {
        throw new OfferLetterError(409, OFFER_LETTER_SNAPSHOT_INCOMPLETE_MESSAGE);
      }
      throw error;
    }
  }

  const { engagement } = await getEngagementContext(input.storage, input.engagementId);
  const documents = await input.storage.listAdminEngagementDocuments(input.engagementId);
  const activeOffer = documents.find((document) => (
    document.documentType === "offer_letter" && document.status !== "voided"
  ));
  if (activeOffer) {
    throw new OfferLetterError(409, "This engagement already has a current offer letter");
  }

  const nextVersion = documents
    .filter((document) => document.documentType === "offer_letter")
    .reduce((max, document) => Math.max(max, document.version), 0) + 1;

  const documentInput: InsertAdminEngagementDocument = {
    engagementId: engagement.id,
    adminUserId: engagement.adminUserId,
    documentType: "offer_letter",
    status: "draft",
    title: input.title.trim(),
    body: input.body.trim(),
    version: nextVersion,
    templateId: input.templateSnapshot?.templateId ?? null,
    templateVersion: input.templateSnapshot?.templateVersion ?? null,
    templateNameSnapshot: input.templateSnapshot?.templateNameSnapshot ?? null,
    templateTitleSnapshot: input.templateSnapshot?.templateTitleSnapshot ?? null,
    templateBodySnapshot: input.templateSnapshot?.templateBodySnapshot ?? null,
    mergeData: input.templateSnapshot?.mergeData ?? null,
    contentFormat: input.templateSnapshot?.contentFormat ?? "plain_text",
    fileContentType: "application/pdf",
    createdBy: input.actorAdminId,
  };

  const document = await input.storage.createAdminEngagementDocumentWithEvent(
    documentInput,
    {
      eventType: "offer_letter_created",
      actorAdminId: input.actorAdminId,
      metadata: {},
      notes: null,
    },
  );

  try {
    return await generateOfferLetterPdfArtifact({
      storage: input.storage,
      objectStorage,
      document,
      actorAdminId: input.actorAdminId,
      reason: "created",
      now: input.now,
    });
  } catch (error) {
    const now = input.now ?? new Date();
    try {
      await input.storage.updateAdminEngagementDocumentWithEvent(
        document.id,
        {
          status: "voided",
          voidedAt: now,
          voidedBy: input.actorAdminId,
        },
        {
          eventType: "offer_letter_voided",
          actorAdminId: input.actorAdminId,
          metadata: safeLifecycleMetadata(document, { reason: "artifact_generation_failed" }),
          notes: null,
        },
      );
    } catch (compensationError) {
      logOfferLetterStorageError("Failed to void unusable offer letter after artifact failure.", compensationError);
    }

    if (!(error instanceof OfferLetterError)) {
      logOfferLetterStorageError("Failed to create offer letter artifact.", error);
    }
    throw new OfferLetterError(503, PREPARE_OFFER_LETTER_ERROR_MESSAGE);
  }
}

export async function regenerateOfferLetterPdf(input: {
  storage: IStorage;
  objectStorage?: OfferLetterObjectStorage;
  engagementId: number;
  documentId: number;
  actorAdminId: number;
  now?: Date;
}): Promise<AdminEngagementDocument> {
  const document = await input.storage.getAdminEngagementDocumentForEngagement(
    input.engagementId,
    input.documentId,
  );
  if (!document) {
    throw new OfferLetterError(404, "Offer letter document not found");
  }
  if (document.documentType !== "offer_letter") {
    throw new OfferLetterError(400, "Document is not an offer letter");
  }
  if (document.status === "accepted" || document.status === "voided") {
    throw new OfferLetterError(409, "Accepted or voided offer letters cannot be regenerated");
  }

  return generateOfferLetterPdfArtifact({
    storage: input.storage,
    objectStorage: input.objectStorage,
    document,
    actorAdminId: input.actorAdminId,
    reason: "regenerated",
    now: input.now,
  });
}

export async function sendOfferLetterDocument(input: {
  storage: IStorage;
  objectStorage?: OfferLetterObjectStorage;
  sendEmail?: OfferLetterEmailSender;
  sendSetupEmail?: OfferLetterSetupEmailSender;
  engagementId: number;
  documentId: number;
  actorAdminId: number;
  now?: Date;
}): Promise<AdminEngagementDocument> {
  const now = input.now ?? new Date();
  let document = await input.storage.getAdminEngagementDocumentForEngagement(
    input.engagementId,
    input.documentId,
  );
  if (!document) {
    throw new OfferLetterError(404, "Offer letter document not found");
  }
  if (document.documentType !== "offer_letter") {
    throw new OfferLetterError(400, "Document is not an offer letter");
  }
  if (!["draft", "sent", "viewed"].includes(document.status)) {
    throw new OfferLetterError(409, "Only draft, sent, or viewed offer letters can be sent");
  }

  const objectStorage = input.objectStorage ?? defaultOfferLetterObjectStorage;
  assertPrivateStorageConfigured(objectStorage);

  let shouldRegenerateArtifact = !document.fileKey || !document.fileSha256;
  if (document.fileKey) {
    try {
      const exists = await objectStorage.privateObjectExists(document.fileKey);
      shouldRegenerateArtifact = shouldRegenerateArtifact || !exists;
    } catch (error) {
      logOfferLetterStorageError("Failed to verify offer letter PDF artifact before sending.", error);
      throw new OfferLetterError(503, OFFER_LETTER_ARTIFACT_UNAVAILABLE_MESSAGE);
    }
  }

  if (shouldRegenerateArtifact) {
    document = await generateOfferLetterPdfArtifact({
      storage: input.storage,
      objectStorage,
      document,
      actorAdminId: input.actorAdminId,
      reason: "send_missing_pdf",
      now,
    });
  }

  const trainee = await input.storage.getAdminUser(document.adminUserId);
  if (!trainee) {
    throw new OfferLetterError(404, "Trainee admin user not found");
  }

  const workspaceUrl = `${getAdminAppOrigin()}/trainee`;
  const setupInvitationSent = await maybeSendDeferredTraineeSetupEmail({
    storage: input.storage,
    sendSetupEmail: input.sendSetupEmail ?? sendTraineeOfferSetupEmail,
    trainee,
    engagementId: input.engagementId,
    actorAdminId: input.actorAdminId,
    workspaceUrl,
    title: document.title,
    now,
  });

  const sendEmail = input.sendEmail ?? sendOfferLetterReadyEmail;
  const sent = setupInvitationSent || (await sendEmail({
    to: trainee.email,
    name: trainee.name,
    workspaceUrl,
    title: document.title,
  }));
  if (!sent) {
    throw new OfferLetterError(502, "Offer letter email could not be sent");
  }

  const nextStatus = document.status === "viewed" ? "viewed" : "sent";
  const isResend = document.status !== "draft" || Boolean(document.sentAt);
  const updated = await input.storage.updateAdminEngagementDocumentWithEvent(
    document.id,
    {
      status: nextStatus,
      sentAt: now,
    },
    {
      eventType: "offer_letter_sent",
      actorAdminId: input.actorAdminId,
      metadata: safeLifecycleMetadata(document, { channel: "email", resend: isResend }),
      notes: null,
    },
  );

  if (!updated) {
    throw new OfferLetterError(404, "Offer letter document not found");
  }

  return updated;
}

async function maybeSendDeferredTraineeSetupEmail(input: {
  storage: IStorage;
  sendSetupEmail: OfferLetterSetupEmailSender;
  trainee: AdminUser;
  engagementId: number;
  actorAdminId: number;
  workspaceUrl: string;
  title: string;
  now: Date;
}) {
  if (
    input.trainee.role !== "trainee_access" ||
    input.trainee.status !== "active" ||
    !input.trainee.mustChangePassword
  ) {
    return false;
  }

  const events = await input.storage.listAdminLifecycleEvents(input.trainee.id);
  if (events.some(isPasswordSetupInvitationEvent)) {
    return false;
  }

  const setupToken = createPasswordSetupToken(input.now);
  const updatedTrainee = await input.storage.refreshPasswordSetupTokenForAdmin(
    input.trainee.id,
    setupToken.tokenHash,
    setupToken.expiresAt,
  );
  if (!updatedTrainee) {
    return false;
  }

  const sent = await input.sendSetupEmail({
    to: updatedTrainee.email,
    name: updatedTrainee.name,
    setupUrl: buildPasswordSetupUrl(setupToken.token),
    workspaceUrl: input.workspaceUrl,
    title: input.title,
  });
  if (!sent) {
    throw new OfferLetterError(502, "Trainee setup email could not be sent");
  }

  await input.storage.createAdminLifecycleEvent({
    adminUserId: updatedTrainee.id,
    engagementId: input.engagementId,
    eventType: "invitation_sent",
    occurredAt: input.now,
    actorAdminId: input.actorAdminId,
    metadata: {
      channel: "email",
      purpose: "trainee_offer_setup",
      source: "offer_letter_send",
    },
    notes: null,
  });

  return true;
}

export async function voidOfferLetterDocument(input: {
  storage: IStorage;
  engagementId: number;
  documentId: number;
  actorAdminId: number;
  now?: Date;
}): Promise<AdminEngagementDocument> {
  const document = await input.storage.getAdminEngagementDocumentForEngagement(
    input.engagementId,
    input.documentId,
  );
  if (!document) {
    throw new OfferLetterError(404, "Offer letter document not found");
  }
  if (document.status === "voided") {
    return document;
  }
  if (document.status === "accepted") {
    // TODO: If an accepted offer must change, create a new version/amendment
    // instead of mutating or voiding the accepted record.
    throw new OfferLetterError(409, "Accepted offer letters cannot be voided");
  }

  const now = input.now ?? new Date();
  const updated = await input.storage.updateAdminEngagementDocumentWithEvent(
    document.id,
    {
      status: "voided",
      voidedAt: now,
      voidedBy: input.actorAdminId,
    },
    {
      eventType: "offer_letter_voided",
      actorAdminId: input.actorAdminId,
      metadata: safeLifecycleMetadata(document),
      notes: null,
    },
  );

  if (!updated) {
    throw new OfferLetterError(404, "Offer letter document not found");
  }

  return updated;
}

export async function viewOfferLetterForTrainee(input: {
  storage: IStorage;
  adminUserId: number;
  documentId: number;
  now?: Date;
}): Promise<AdminEngagementDocument> {
  const document = await input.storage.getTraineeEngagementDocument(input.adminUserId, input.documentId);
  if (!document) {
    throw new OfferLetterError(404, "Offer letter document not found");
  }
  if (document.status === "voided") {
    throw new OfferLetterError(409, "This offer letter is no longer available");
  }
  if (document.status === "draft") {
    throw new OfferLetterError(404, "Offer letter document not found");
  }

  const updated = await input.storage.markOfferLetterViewed(
    input.documentId,
    input.adminUserId,
    input.now ?? new Date(),
  );
  return updated ?? document;
}

export async function acceptOfferLetterForTrainee(input: {
  storage: IStorage;
  adminUserId: number;
  documentId: number;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
}): Promise<AdminEngagementDocument> {
  const document = await input.storage.getTraineeEngagementDocument(input.adminUserId, input.documentId);
  if (!document) {
    throw new OfferLetterError(404, "Offer letter document not found");
  }
  if (document.status === "accepted") {
    return await input.storage.markOfferLetterAccepted(input.documentId, input.adminUserId, {
      now: input.now ?? new Date(),
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    }) ?? document;
  }
  if (document.status === "voided") {
    throw new OfferLetterError(409, "This offer letter is no longer available");
  }
  if (!["sent", "viewed"].includes(document.status)) {
    throw new OfferLetterError(409, "Only sent or viewed offer letters can be accepted");
  }
  if (!document.fileKey || !document.fileSha256) {
    throw new OfferLetterError(409, "Offer letter PDF artifact is not ready");
  }

  const updated = await input.storage.markOfferLetterAccepted(input.documentId, input.adminUserId, {
    now: input.now ?? new Date(),
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  });

  if (!updated) {
    throw new OfferLetterError(404, "Offer letter document not found");
  }
  if (updated.status !== "accepted") {
    throw new OfferLetterError(409, "Offer letter could not be accepted");
  }

  return updated;
}

export async function getOfferLetterDownload(input: {
  storage: IStorage;
  objectStorage?: OfferLetterObjectStorage;
  requester: "admin" | "trainee";
  engagementId?: number;
  adminUserId?: number;
  documentId: number;
}): Promise<{ document: AdminEngagementDocument; object: PrivateObjectBuffer; filename: string }> {
  const document = input.requester === "admin"
    ? await input.storage.getAdminEngagementDocumentForEngagement(input.engagementId!, input.documentId)
    : await input.storage.getTraineeEngagementDocument(input.adminUserId!, input.documentId);

  if (!document) {
    throw new OfferLetterError(404, "Offer letter document not found");
  }
  if (document.status === "voided") {
    throw new OfferLetterError(409, "This offer letter is no longer available");
  }
  if (input.requester === "trainee" && document.status === "draft") {
    throw new OfferLetterError(404, "Offer letter document not found");
  }
  if (!document.fileKey) {
    throw new OfferLetterError(409, "Offer letter PDF artifact is not ready");
  }

  const objectStorage = input.objectStorage ?? defaultOfferLetterObjectStorage;
  assertPrivateStorageConfigured(objectStorage);
  let object: PrivateObjectBuffer;
  try {
    object = await objectStorage.getPrivateObjectBuffer(document.fileKey);
  } catch (error) {
    logOfferLetterStorageError("Failed to read offer letter PDF artifact for download.", error);
    throw new OfferLetterError(503, OFFER_LETTER_ARTIFACT_UNAVAILABLE_MESSAGE);
  }

  return {
    document,
    object,
    filename: `offer-letter-v${document.version}.pdf`,
  };
}
