import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  acceptOfferLetterForTrainee,
  createOfferLetterDocument,
  createOfferLetterDocumentFromTemplate,
  getOfferLetterDownload,
  OfferLetterError,
  regenerateOfferLetterPdf,
  sendOfferLetterDocument,
  viewOfferLetterForTrainee,
  voidOfferLetterDocument,
  type OfferLetterObjectStorage,
} from "./offerLetterService";
import {
  createDocumentTemplate,
  DocumentTemplateError,
  previewOfferLetterTemplate,
  updateDocumentTemplate,
} from "./documentTemplateService";

const CPT_TEMPLATE_NAME = "CPT Internship Offer Letter";

class MemoryOfferLetterStorage {
  admins = new Map<number, any>();
  engagements = new Map<number, any>();
  documents = new Map<number, any>();
  templates = new Map<number, any>();
  events: any[] = [];

  seedAdmin(overrides: Record<string, any> = {}) {
    const admin = {
      id: this.admins.size + 1,
      name: `Admin ${this.admins.size + 1}`,
      email: `admin-${this.admins.size + 1}@example.com`,
      role: "trainee_access",
      status: "active",
      mustChangePassword: false,
      passwordSetupTokenHash: null,
      passwordSetupExpiresAt: null,
      ...overrides,
    };
    this.admins.set(admin.id, admin);
    return admin;
  }

  seedEngagement(adminUserId: number, overrides: Record<string, any> = {}) {
    const engagement = {
      id: this.engagements.size + 1,
      adminUserId,
      engagementType: "intern",
      scheduleType: "part_time",
      workAuthorizationType: "none",
      startDate: "2026-06-01",
      endDate: "2026-08-31",
      supervisorAdminId: null,
      workScope: "Training",
      expectedHoursPerWeek: 20,
      status: "invited",
      createdAt: new Date("2026-05-01T00:00:00Z"),
      updatedAt: new Date("2026-05-01T00:00:00Z"),
      ...overrides,
    };
    this.engagements.set(engagement.id, engagement);
    return engagement;
  }

  seedDocument(overrides: Record<string, any> = {}) {
    const engagement = this.engagements.get(overrides.engagementId);
    const document = {
      id: this.documents.size + 1,
      engagementId: engagement.id,
      adminUserId: engagement.adminUserId,
      documentType: "offer_letter",
      status: "sent",
      title: "Offer Letter",
      body: "Please review this offer letter.",
      version: 1,
      templateId: null,
      templateVersion: null,
      templateNameSnapshot: null,
      templateTitleSnapshot: null,
      templateBodySnapshot: null,
      mergeData: null,
      contentFormat: "plain_text",
      fileKey: "engagement-documents/1/1/v1/offer-letter.pdf",
      fileSha256: "hash",
      fileContentType: "application/pdf",
      fileSizeBytes: 12,
      sentAt: new Date("2026-05-02T00:00:00Z"),
      viewedAt: null,
      acceptedAt: null,
      acceptedBy: null,
      acceptedIp: null,
      acceptedUserAgent: null,
      declinedAt: null,
      voidedAt: null,
      voidedBy: null,
      createdBy: 99,
      createdAt: new Date("2026-05-01T00:00:00Z"),
      updatedAt: new Date("2026-05-01T00:00:00Z"),
      ...overrides,
    };
    this.documents.set(document.id, document);
    return document;
  }

  seedTemplate(overrides: Record<string, any> = {}) {
    const now = new Date("2026-05-01T00:00:00Z");
    const template = {
      id: this.templates.size + 1,
      documentType: "offer_letter",
      name: `Offer Template ${this.templates.size + 1}`,
      description: null,
      status: "active",
      version: 1,
      titleTemplate: "{{trainee_name}} Offer Letter",
      bodyTemplate: "Dear {{trainee_name}},\n\n{{compensation_text}}",
      contentFormat: "plain_text",
      allowedVariables: ["trainee_name", "compensation_text"],
      createdBy: 99,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
    this.templates.set(template.id, template);
    return template;
  }

  async getAdminEngagement(id: number) {
    return this.engagements.get(id);
  }

  async getAdminUser(id: number) {
    return this.admins.get(id);
  }

  async refreshPasswordSetupTokenForAdmin(id: number, tokenHash: string, expiresAt: Date) {
    const existing = this.admins.get(id);
    if (!existing || existing.status !== "active" || existing.mustChangePassword !== true) {
      return undefined;
    }
    const updated = {
      ...existing,
      passwordSetupTokenHash: tokenHash,
      passwordSetupExpiresAt: expiresAt,
      updatedAt: new Date("2026-05-06T00:00:00Z"),
    };
    this.admins.set(id, updated);
    return updated;
  }

  async listAdminLifecycleEvents(adminUserId: number) {
    return this.events.filter((event) => event.adminUserId === adminUserId);
  }

  async createAdminLifecycleEvent(event: any) {
    const created = {
      id: this.events.length + 1,
      occurredAt: event.occurredAt ?? new Date("2026-05-06T00:00:00Z"),
      createdAt: new Date("2026-05-06T00:00:00Z"),
      ...event,
    };
    this.events.push(created);
    return created;
  }

  async listAdminEngagementDocuments(engagementId: number) {
    return [...this.documents.values()].filter((document) => document.engagementId === engagementId);
  }

  async listAdminDocumentTemplates(filters?: { documentType?: string }) {
    return [...this.templates.values()].filter((template) => (
      !filters?.documentType || template.documentType === filters.documentType
    ));
  }

  async getAdminDocumentTemplate(id: number) {
    return this.templates.get(id);
  }

  async createAdminDocumentTemplate(templateInput: any) {
    const now = new Date("2026-05-03T00:00:00Z");
    const template = {
      id: this.templates.size + 1,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      ...templateInput,
    };
    this.templates.set(template.id, template);
    return template;
  }

  async updateAdminDocumentTemplate(id: number, updates: Record<string, any>) {
    const existing = this.templates.get(id);
    if (!existing) return undefined;
    const template = { ...existing, ...updates, updatedAt: new Date("2026-05-04T00:00:00Z") };
    this.templates.set(id, template);
    return template;
  }

  async listTraineeEngagementDocuments(adminUserId: number) {
    return [...this.documents.values()].filter((document) => document.adminUserId === adminUserId);
  }

  async getAdminEngagementDocumentForEngagement(engagementId: number, documentId: number) {
    const document = this.documents.get(documentId);
    return document?.engagementId === engagementId ? document : undefined;
  }

  async getTraineeEngagementDocument(adminUserId: number, documentId: number) {
    const document = this.documents.get(documentId);
    return document?.adminUserId === adminUserId ? document : undefined;
  }

  async createAdminEngagementDocumentWithEvent(documentInput: any, event: any) {
    const now = new Date("2026-05-03T00:00:00Z");
    const document = {
      id: this.documents.size + 1,
      sentAt: null,
      viewedAt: null,
      acceptedAt: null,
      acceptedBy: null,
      acceptedIp: null,
      acceptedUserAgent: null,
      declinedAt: null,
      voidedAt: null,
      voidedBy: null,
      fileKey: null,
      fileSha256: null,
      fileSizeBytes: null,
      createdAt: now,
      updatedAt: now,
      ...documentInput,
    };
    this.documents.set(document.id, document);
    this.events.push({
      ...event,
      adminUserId: document.adminUserId,
      engagementId: document.engagementId,
      metadata: { document_id: document.id, document_version: document.version },
    });
    return document;
  }

  async updateAdminEngagementDocumentWithEvent(id: number, updates: Record<string, any>, event: any) {
    const existing = this.documents.get(id);
    if (!existing) return undefined;
    const document = { ...existing, ...updates, updatedAt: new Date("2026-05-04T00:00:00Z") };
    this.documents.set(id, document);
    this.events.push({
      ...event,
      adminUserId: document.adminUserId,
      engagementId: document.engagementId,
      metadata: { document_id: document.id, document_version: document.version, ...(event.metadata ?? {}) },
    });
    return document;
  }

  async markOfferLetterViewed(documentId: number, adminUserId: number, now: Date) {
    const document = await this.getTraineeEngagementDocument(adminUserId, documentId);
    if (!document || document.status !== "sent") return document;
    const updated = { ...document, status: "viewed", viewedAt: now, updatedAt: now };
    this.documents.set(documentId, updated);
    this.events.push({
      adminUserId,
      engagementId: updated.engagementId,
      eventType: "offer_letter_viewed",
      occurredAt: now,
      actorAdminId: adminUserId,
      metadata: { document_id: updated.id, document_version: updated.version },
    });
    return updated;
  }

  async markOfferLetterAccepted(
    documentId: number,
    adminUserId: number,
    input: { now: Date; ip?: string | null; userAgent?: string | null }
  ) {
    const document = await this.getTraineeEngagementDocument(adminUserId, documentId);
    if (!document || document.status === "accepted" || !["sent", "viewed"].includes(document.status)) {
      return document;
    }
    const updated = {
      ...document,
      status: "accepted",
      acceptedAt: input.now,
      acceptedBy: adminUserId,
      acceptedIp: input.ip ?? null,
      acceptedUserAgent: input.userAgent ?? null,
      updatedAt: input.now,
    };
    this.documents.set(documentId, updated);
    this.events.push({
      adminUserId,
      engagementId: updated.engagementId,
      eventType: "offer_letter_accepted",
      occurredAt: input.now,
      actorAdminId: adminUserId,
      metadata: { document_id: updated.id, document_version: updated.version },
    });
    return updated;
  }

  async hasAcceptedOfferLetterForEngagement(engagementId: number) {
    return [...this.documents.values()].some((document) => (
      document.engagementId === engagementId &&
      document.documentType === "offer_letter" &&
      document.status === "accepted" &&
      document.acceptedAt &&
      !document.voidedAt
    ));
  }
}

function createPrivateObjectStore(options: {
  failPut?: boolean;
  failExists?: boolean;
  failGet?: boolean;
} = {}): OfferLetterObjectStorage & {
  objects: Map<string, Buffer>;
  putCount: number;
  existsChecks: string[];
} {
  const objects = new Map<string, Buffer>();
  const store = {
    objects,
    putCount: 0,
    existsChecks: [] as string[],
    isConfigured: () => true,
    async putPrivateObject(input: Parameters<OfferLetterObjectStorage["putPrivateObject"]>[0]) {
      assert.doesNotMatch(input.key, /^https?:\/\//);
      store.putCount += 1;
      if (options.failPut) {
        throw new Error("R2 PutObject failed for bucket secret-bucket at https://private-r2.example/internal-key");
      }
      objects.set(input.key, input.buffer);
    },
    async privateObjectExists(key: string) {
      store.existsChecks.push(key);
      if (options.failExists) {
        throw new Error(`R2 HeadObject failed for secret-bucket ${key} https://private-r2.example`);
      }
      return objects.has(key);
    },
    async getPrivateObjectBuffer(key: string) {
      if (options.failGet) {
        throw new Error(`R2 GetObject failed for secret-bucket ${key} https://private-r2.example`);
      }
      const buffer = objects.get(key);
      if (!buffer) {
        throw new Error(`NoSuchKey secret-bucket ${key}`);
      }
      return {
        buffer,
        contentType: "application/pdf",
        contentLength: buffer.byteLength,
      };
    },
  };
  return store;
}

async function withMutedConsoleError<T>(callback: () => Promise<T>): Promise<T> {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    return await callback();
  } finally {
    console.error = originalConsoleError;
  }
}

test("super admin flow creates a private offer letter artifact for a trainee engagement", async () => {
  const store = new MemoryOfferLetterStorage();
  const trainee = store.seedAdmin();
  const engagement = store.seedEngagement(trainee.id);
  const objectStorage = createPrivateObjectStore();

  const document = await createOfferLetterDocument({
    storage: store as any,
    objectStorage,
    engagementId: engagement.id,
    actorAdminId: 99,
    title: "  Trainee Offer Letter  ",
    body: "  Welcome to the trainee program.  ",
    now: new Date("2026-05-05T00:00:00Z"),
  });

  assert.equal(document.title, "Trainee Offer Letter");
  assert.equal(document.body, "Welcome to the trainee program.");
  assert.match(document.fileKey, /^engagement-documents\/1\/1\/v1\/offer-letter\.pdf$/);
  assert.doesNotMatch(document.fileKey, /r2\.dev|https?:\/\//);
  assert.ok(document.fileSha256);
  assert.ok(document.fileSizeBytes > 0);
  assert.deepEqual(
    store.events.map((event) => event.eventType),
    ["offer_letter_created", "offer_letter_pdf_generated"],
  );
});

test("document template create rejects unsupported variables", async () => {
  const store = new MemoryOfferLetterStorage();

  await assert.rejects(
    createDocumentTemplate({
      storage: store as any,
      actorAdminId: 99,
      documentType: "offer_letter",
      name: "Unsafe Template",
      status: "active",
      titleTemplate: "{{trainee_name}} Offer Letter",
      bodyTemplate: "Hello {{execute_javascript}}",
      contentFormat: "plain_text",
    }),
    (error: any) => (
      error instanceof DocumentTemplateError &&
      error.statusCode === 400 &&
      Array.isArray(error.details.unknown_variables) &&
      error.details.unknown_variables.includes("execute_javascript")
    ),
  );
});

test("active document template edits create a new version and archive the old version", async () => {
  const store = new MemoryOfferLetterStorage();
  const activeTemplate = store.seedTemplate({
    name: "Versioned Offer Template",
    status: "active",
    version: 2,
    titleTemplate: "Original {{trainee_name}}",
    bodyTemplate: "Original body {{compensation_text}}",
  });

  const nextTemplate = await updateDocumentTemplate({
    storage: store as any,
    templateId: activeTemplate.id,
    actorAdminId: 123,
    updates: {
      name: "Versioned Offer Template",
      titleTemplate: "Updated {{trainee_name}}",
      bodyTemplate: "Updated body {{compensation_text}}",
      status: "active",
    },
  });

  const archivedTemplate = store.templates.get(activeTemplate.id);
  assert.notEqual(nextTemplate.id, activeTemplate.id);
  assert.equal(nextTemplate.version, 3);
  assert.equal(nextTemplate.status, "active");
  assert.equal(nextTemplate.createdBy, 123);
  assert.equal(nextTemplate.titleTemplate, "Updated {{trainee_name}}");
  assert.equal(archivedTemplate.status, "archived");
  assert.ok(archivedTemplate.archivedAt);
});

test("template preview derives safe variables and applies manual merge values", async () => {
  const store = new MemoryOfferLetterStorage();
  const trainee = store.seedAdmin({ name: "Trainee User", email: "trainee@example.com" });
  const supervisor = store.seedAdmin({ name: "Supervisor User", email: "supervisor@example.com", role: "admin_support" });
  const engagement = store.seedEngagement(trainee.id, {
    supervisorAdminId: supervisor.id,
    workAuthorizationType: "cpt",
    workScope: "Shadow support workflows",
  });
  const template = store.seedTemplate({
    titleTemplate: "{{trainee_name}} - {{engagement_title}}",
    bodyTemplate: [
      "{{trainee_email}}",
      "{{function_area}}",
      "{{supervisor_name}} <{{supervisor_email}}>",
      "{{work_authorization_type}}",
      "{{compensation_text}}",
    ].join("\n"),
  });

  const preview = await previewOfferLetterTemplate({
    storage: store as any,
    engagementId: engagement.id,
    templateId: template.id,
    manualValues: {
      engagementTitle: "Operations Trainee",
      functionArea: "Operations",
      compensationText: "This trainee engagement is unpaid.",
    },
  });

  assert.equal(preview.title, "Trainee User - Operations Trainee");
  assert.match(preview.body, /trainee@example\.com/);
  assert.match(preview.body, /Supervisor User <supervisor@example\.com>/);
  assert.match(preview.body, /cpt/);
  assert.equal(preview.mergeData.engagement_title, "Operations Trainee");
  assert.equal(preview.mergeData.function_area, "Operations");
  assert.equal(preview.mergeData.compensation_text, "This trainee engagement is unpaid.");
});

test("CPT seed migration creates active plain-text template without historical return instructions", async () => {
  const migration = await readFile(new URL("../migrations/0009_cpt_offer_letter_template.sql", import.meta.url), "utf8");

  assert.match(migration, new RegExp(CPT_TEMPLATE_NAME));
  assert.match(migration, /'active'/);
  assert.match(migration, /'plain_text'/);
  assert.match(migration, /valid F-1 Curricular Practical Training \(CPT\) authorization/);
  assert.match(migration, /begin on \{\{start_date\}\} and end on \{\{end_date\}\}/);
  assert.match(migration, /\{\{expected_hours_per_week\}\} hours per week/);
  assert.match(migration, /\{\{work_location\}\}/);
  assert.match(migration, /\{\{supervisor_name\}\} \(\{\{supervisor_email\}\}\)/);
  assert.match(migration, /\{\{responsibilities_text\}\}/);
  assert.match(migration, /Confidentiality and Intellectual Property/);
  assert.match(migration, /Trainee Workspace/);
  assert.doesNotMatch(migration, /gmail/i);
  assert.doesNotMatch(migration, /scanned copy/i);
  assert.doesNotMatch(migration, /docusign|e-signature|resume upload|resume parsing/i);
});

test("CPT training alignment migration updates template without resume storage workflow", async () => {
  const migration = await readFile(new URL("../migrations/0010_cpt_training_alignment_template.sql", import.meta.url), "utf8");

  assert.match(migration, new RegExp(CPT_TEMPLATE_NAME));
  assert.match(migration, /\{\{program_or_major\}\}/);
  assert.match(migration, /\{\{training_alignment_text\}\}/);
  assert.match(migration, /practical training related to your academic background/);
  assert.match(migration, /prior experience, academic training, and supervised learning objectives/);
  assert.match(migration, /"version" = "version" \+ 1/);
  assert.match(migration, /WHERE "document_type" = 'offer_letter'/);
  assert.doesNotMatch(migration, /resume upload|resume parsing|candidate lifecycle|rejected candidate|raw resume/i);
  assert.doesNotMatch(migration, /docusign|e-signature|gmail|scanned copy/i);
});

test("CPT template preview applies manual fields and safe defaults", async () => {
  const store = new MemoryOfferLetterStorage();
  const trainee = store.seedAdmin({ name: "CPT Trainee", email: "cpt@example.edu" });
  const supervisor = store.seedAdmin({ name: "CPT Supervisor", email: "supervisor@example.com", role: "admin_support" });
  const engagement = store.seedEngagement(trainee.id, {
    supervisorAdminId: supervisor.id,
    workAuthorizationType: "cpt",
    workScope: "Build internal workflow documentation and supervised prototypes.",
    expectedHoursPerWeek: 21,
  });
  const template = store.seedTemplate({
    name: CPT_TEMPLATE_NAME,
    titleTemplate: "Offer of Internship for {{engagement_title}}",
    bodyTemplate: [
      "School: {{school_name}}",
      "Program: {{program_or_major}}",
      "Location: {{work_location}}",
      "Deadline: {{response_deadline}}",
      "Responsibilities: {{responsibilities_text}}",
      "Alignment: {{training_alignment_text}}",
      "Compensation: {{compensation_text}}",
      "Supervisor: {{supervisor_name}} ({{supervisor_email}})",
      "Signatory: {{signatory_name}}, {{signatory_title}}",
      "Phone: {{company_phone}}",
      "Email: {{company_email}}",
    ].join("\n"),
  });

  const preview = await previewOfferLetterTemplate({
    storage: store as any,
    engagementId: engagement.id,
    templateId: template.id,
    manualValues: {
      engagementTitle: "Product Operations Intern",
      schoolName: "Example University",
      programOrMajor: "Information Systems",
      responseDeadline: "July 15, 2026",
    },
  });

  assert.equal(preview.title, "Offer of Internship for Product Operations Intern");
  assert.equal(preview.mergeData.school_name, "Example University");
  assert.equal(preview.mergeData.program_or_major, "Information Systems");
  assert.equal(preview.mergeData.work_location, "Remote");
  assert.equal(preview.mergeData.response_deadline, "July 15, 2026");
  assert.equal(preview.mergeData.responsibilities_text, "Build internal workflow documentation and supervised prototypes.");
  assert.equal(
    preview.mergeData.training_alignment_text,
    "The activities in this engagement are designed to provide supervised practical training aligned with the student's academic background and prior experience.",
  );
  assert.equal(preview.mergeData.compensation_text, "Unpaid internship position for academic practical training purposes.");
  assert.equal(preview.mergeData.signatory_name, "CPT Supervisor");
  assert.equal(preview.mergeData.signatory_title, "Founder & Manager");
  assert.equal(preview.mergeData.company_phone, "Not provided");
  assert.equal(preview.mergeData.company_email, "Not provided");
  assert.match(preview.body, /School: Example University/);
  assert.match(preview.body, /Program: Information Systems/);
  assert.match(preview.body, /Location: Remote/);
  assert.match(preview.body, /Responsibilities: Build internal workflow documentation/);
  assert.match(preview.body, /Alignment: The activities in this engagement are designed/);
});

test("CPT template preview blocks unresolved required manual fields with controlled errors", async () => {
  const store = new MemoryOfferLetterStorage();
  const trainee = store.seedAdmin();
  const engagement = store.seedEngagement(trainee.id);
  const template = store.seedTemplate({
    name: CPT_TEMPLATE_NAME,
    titleTemplate: "{{engagement_title}}",
    bodyTemplate: "{{school_name}}\n{{program_or_major}}\n{{response_deadline}}\n{{responsibilities_text}}\n{{training_alignment_text}}\n{{work_location}}\n{{compensation_text}}\n{{signatory_name}}\n{{signatory_title}}",
  });

  await assert.rejects(
    previewOfferLetterTemplate({
      storage: store as any,
      engagementId: engagement.id,
      templateId: template.id,
      manualValues: {
        engagementTitle: "CPT Intern",
        responsibilitiesText: "Training activities.",
        trainingAlignmentText: "Training aligned with academic background.",
        workLocation: "Remote",
        compensationText: "Unpaid internship position for academic practical training purposes.",
        signatoryName: "Admin Signatory",
        signatoryTitle: "Founder & Manager",
      },
    }),
    (error: any) => (
      error instanceof DocumentTemplateError &&
      error.statusCode === 400 &&
      error.message === "Template variables are missing required values." &&
      Array.isArray(error.details.missing_variables) &&
      error.details.missing_variables.includes("school_name") &&
      error.details.missing_variables.includes("program_or_major") &&
      error.details.missing_variables.includes("response_deadline")
    ),
  );
});

test("CPT template document creation snapshots merge data and final body", async () => {
  const store = new MemoryOfferLetterStorage();
  const trainee = store.seedAdmin({ name: "Snapshot CPT", email: "snapshot-cpt@example.edu" });
  const engagement = store.seedEngagement(trainee.id, {
    workAuthorizationType: "cpt",
    workScope: "Original supervised training responsibilities.",
  });
  const template = store.seedTemplate({
    name: CPT_TEMPLATE_NAME,
    version: 2,
    titleTemplate: "Offer of Internship for {{engagement_title}}",
    bodyTemplate: [
      "School: {{school_name}}",
      "Program: {{program_or_major}}",
      "Responsibilities: {{responsibilities_text}}",
      "Alignment: {{training_alignment_text}}",
      "Deadline: {{response_deadline}}",
      "{{signatory_name}}",
      "{{signatory_title}}",
    ].join("\n"),
  });
  const objectStorage = createPrivateObjectStore();
  const generatedAt = new Date("2026-05-05T00:00:00Z");

  const document = await createOfferLetterDocumentFromTemplate({
    storage: store as any,
    objectStorage,
    engagementId: engagement.id,
    actorAdminId: 99,
    templateId: template.id,
    manualValues: {
      engagementTitle: "CPT Product Intern",
      schoolName: "Example University",
      programOrMajor: "Computer Science",
      responseDeadline: "July 15, 2026",
      trainingAlignmentText: "This training aligns with coursework in software systems and product operations.",
      signatoryName: "Admin Signatory",
      signatoryTitle: "Program Manager",
    },
    now: generatedAt,
  });

  const originalHash = document.fileSha256;
  assert.equal(document.templateId, template.id);
  assert.equal(document.templateVersion, 2);
  assert.equal(document.templateNameSnapshot, CPT_TEMPLATE_NAME);
  assert.match(document.body, /Program: Computer Science/);
  assert.match(document.body, /Alignment: This training aligns with coursework/);
  assert.equal(document.mergeData.school_name, "Example University");
  assert.equal(document.mergeData.program_or_major, "Computer Science");
  assert.equal(document.mergeData.responsibilities_text, "Original supervised training responsibilities.");
  assert.equal(
    document.mergeData.training_alignment_text,
    "This training aligns with coursework in software systems and product operations.",
  );

  store.engagements.set(engagement.id, {
    ...engagement,
    workScope: "Changed live responsibilities.",
  });
  const regenerated = await regenerateOfferLetterPdf({
    storage: store as any,
    objectStorage,
    engagementId: engagement.id,
    documentId: document.id,
    actorAdminId: 99,
    now: generatedAt,
  });

  assert.equal(regenerated.fileSha256, originalHash);
  assert.match(regenerated.body, /Alignment: This training aligns with coursework/);
  assert.equal(regenerated.mergeData.responsibilities_text, "Original supervised training responsibilities.");
  assert.equal(regenerated.mergeData.training_alignment_text, "This training aligns with coursework in software systems and product operations.");
});

test("template offer creation stores template and merge snapshots with frozen final body", async () => {
  const store = new MemoryOfferLetterStorage();
  const trainee = store.seedAdmin({ name: "Snapshot Trainee", email: "snapshot@example.com" });
  const engagement = store.seedEngagement(trainee.id);
  const template = store.seedTemplate({
    name: "Snapshot Template",
    version: 3,
    titleTemplate: "{{trainee_name}} / {{engagement_title}}",
    bodyTemplate: "Dear {{trainee_name}},\n\n{{compensation_text}}",
  });

  const document = await createOfferLetterDocumentFromTemplate({
    storage: store as any,
    objectStorage: createPrivateObjectStore(),
    engagementId: engagement.id,
    actorAdminId: 99,
    templateId: template.id,
    manualValues: {
      engagementTitle: "Research Trainee",
      compensationText: "Compensation will be handled separately.",
    },
    body: "Final edited body.",
    now: new Date("2026-05-05T00:00:00Z"),
  });

  assert.equal(document.templateId, template.id);
  assert.equal(document.templateVersion, 3);
  assert.equal(document.templateNameSnapshot, "Snapshot Template");
  assert.equal(document.templateTitleSnapshot, template.titleTemplate);
  assert.equal(document.templateBodySnapshot, template.bodyTemplate);
  assert.equal(document.title, "Snapshot Trainee / Research Trainee");
  assert.equal(document.body, "Final edited body.");
  assert.equal(document.mergeData.compensation_text, "Compensation will be handled separately.");
  assert.ok(document.fileSha256);
});

test("PDF regeneration for template documents uses merge snapshot instead of changed live data", async () => {
  const store = new MemoryOfferLetterStorage();
  const trainee = store.seedAdmin({ name: "Original Trainee", email: "original@example.com" });
  const supervisor = store.seedAdmin({ name: "Original Supervisor", email: "original-supervisor@example.com", role: "admin_support" });
  const engagement = store.seedEngagement(trainee.id, {
    supervisorAdminId: supervisor.id,
    startDate: "2026-06-01",
    endDate: "2026-08-31",
  });
  const template = store.seedTemplate({
    titleTemplate: "{{trainee_name}} Offer",
    bodyTemplate: "Supervisor: {{supervisor_name}}\n{{compensation_text}}",
  });
  const objectStorage = createPrivateObjectStore();
  const generatedAt = new Date("2026-05-05T00:00:00Z");

  const document = await createOfferLetterDocumentFromTemplate({
    storage: store as any,
    objectStorage,
    engagementId: engagement.id,
    actorAdminId: 99,
    templateId: template.id,
    manualValues: {
      compensationText: "No compensation is provided.",
    },
    now: generatedAt,
  });
  const firstHash = document.fileSha256;

  store.admins.set(trainee.id, { ...trainee, name: "Changed Trainee", email: "changed@example.com" });
  store.admins.set(supervisor.id, { ...supervisor, name: "Changed Supervisor", email: "changed-supervisor@example.com" });
  store.engagements.set(engagement.id, { ...engagement, startDate: "2027-01-01", endDate: "2027-12-31" });

  const regenerated = await regenerateOfferLetterPdf({
    storage: store as any,
    objectStorage,
    engagementId: engagement.id,
    documentId: document.id,
    actorAdminId: 99,
    now: generatedAt,
  });

  assert.equal(regenerated.fileSha256, firstHash);
});

test("snapshot PDF regeneration fails safely when required merge data is incomplete", async () => {
  const store = new MemoryOfferLetterStorage();
  const trainee = store.seedAdmin({ name: "Live Trainee", email: "live@example.com" });
  const engagement = store.seedEngagement(trainee.id);
  const document = store.seedDocument({
    engagementId: engagement.id,
    status: "draft",
    mergeData: {
      trainee_name: "Snapshot Trainee",
    },
  });
  const objectStorage = createPrivateObjectStore();
  let liveContextRead = false;
  store.getAdminEngagement = async () => {
    liveContextRead = true;
    throw new Error("live engagement context should not be read for snapshot PDFs");
  };

  await assert.rejects(
    regenerateOfferLetterPdf({
      storage: store as any,
      objectStorage,
      engagementId: engagement.id,
      documentId: document.id,
      actorAdminId: 99,
    }),
    (error: any) => (
      error instanceof OfferLetterError &&
      error.statusCode === 409 &&
      error.message === "Offer letter snapshot is incomplete. Please create a new offer letter version."
    ),
  );

  assert.equal(liveContextRead, false);
  assert.equal(objectStorage.putCount, 0);
  assert.equal(store.documents.get(document.id).fileSha256, "hash");
});

test("template updates after create do not affect frozen document body or regenerated snapshot PDF", async () => {
  const store = new MemoryOfferLetterStorage();
  const trainee = store.seedAdmin({ name: "Frozen Trainee", email: "frozen@example.com" });
  const engagement = store.seedEngagement(trainee.id);
  const template = store.seedTemplate({
    titleTemplate: "{{trainee_name}} Offer",
    bodyTemplate: "Original template body.\n{{compensation_text}}",
  });
  const objectStorage = createPrivateObjectStore();
  const generatedAt = new Date("2026-05-05T00:00:00Z");

  const document = await createOfferLetterDocumentFromTemplate({
    storage: store as any,
    objectStorage,
    engagementId: engagement.id,
    actorAdminId: 99,
    templateId: template.id,
    manualValues: {
      compensationText: "Frozen compensation text.",
    },
    now: generatedAt,
  });
  const originalHash = document.fileSha256;
  const originalTitle = document.title;
  const originalBody = document.body;

  await store.updateAdminDocumentTemplate(template.id, {
    titleTemplate: "Changed {{trainee_name}}",
    bodyTemplate: "Changed template body.",
    version: 2,
  });

  const regenerated = await regenerateOfferLetterPdf({
    storage: store as any,
    objectStorage,
    engagementId: engagement.id,
    documentId: document.id,
    actorAdminId: 99,
    now: generatedAt,
  });

  assert.equal(regenerated.title, originalTitle);
  assert.equal(regenerated.body, originalBody);
  assert.equal(regenerated.templateTitleSnapshot, template.titleTemplate);
  assert.equal(regenerated.templateBodySnapshot, template.bodyTemplate);
  assert.equal(regenerated.fileSha256, originalHash);
});

test("legacy direct body PDF regeneration keeps existing live context fallback", async () => {
  const store = new MemoryOfferLetterStorage();
  const trainee = store.seedAdmin({ name: "Legacy Trainee", email: "legacy@example.com" });
  const engagement = store.seedEngagement(trainee.id);
  const document = store.seedDocument({
    engagementId: engagement.id,
    status: "draft",
    mergeData: null,
  });
  const objectStorage = createPrivateObjectStore();
  let liveContextRead = false;
  const originalGetAdminEngagement = store.getAdminEngagement.bind(store);
  store.getAdminEngagement = async (id: number) => {
    liveContextRead = true;
    return originalGetAdminEngagement(id);
  };

  const regenerated = await regenerateOfferLetterPdf({
    storage: store as any,
    objectStorage,
    engagementId: engagement.id,
    documentId: document.id,
    actorAdminId: 99,
    now: new Date("2026-05-05T00:00:00Z"),
  });

  assert.equal(liveContextRead, true);
  assert.ok(regenerated.fileSha256);
  assert.equal(objectStorage.putCount, 1);
});

test("offer letter creation rejects non-trainee engagements", async () => {
  const store = new MemoryOfferLetterStorage();
  const admin = store.seedAdmin({ role: "admin_finance" });
  const engagement = store.seedEngagement(admin.id);

  await assert.rejects(
    createOfferLetterDocument({
      storage: store as any,
      objectStorage: createPrivateObjectStore(),
      engagementId: engagement.id,
      actorAdminId: 99,
      title: "Offer Letter",
      body: "Body",
    }),
    /only for trainee engagements/,
  );
});

test("offer letter send uses a link-only trainee workspace email and marks sent", async () => {
  const store = new MemoryOfferLetterStorage();
  const trainee = store.seedAdmin({ name: "Trainee User", email: "trainee@example.com" });
  const engagement = store.seedEngagement(trainee.id);
  const document = store.seedDocument({ engagementId: engagement.id, status: "draft" });
  const objectStorage = createPrivateObjectStore();
  objectStorage.objects.set(document.fileKey, Buffer.from("pdf"));
  let emailInput: any;

  const sent = await sendOfferLetterDocument({
    storage: store as any,
    objectStorage,
    engagementId: engagement.id,
    documentId: document.id,
    actorAdminId: 99,
    sendEmail: async (input) => {
      emailInput = input;
      return true;
    },
    now: new Date("2026-05-06T00:00:00Z"),
  });

  assert.equal(sent.status, "sent");
  assert.equal(emailInput.to, "trainee@example.com");
  assert.match(emailInput.workspaceUrl, /\/trainee$/);
  assert.doesNotMatch(emailInput.workspaceUrl, /token|document|bearer/i);
  assert.deepEqual(objectStorage.existsChecks, [document.fileKey]);
  assert.equal(store.events.at(-1).eventType, "offer_letter_sent");
});

test("sending offer after deferred setup sends setup access email and records invitation", async () => {
  const store = new MemoryOfferLetterStorage();
  const trainee = store.seedAdmin({
    name: "Deferred Trainee",
    email: "deferred@example.com",
    mustChangePassword: true,
    passwordSetupTokenHash: "old-hash",
    passwordSetupExpiresAt: new Date("2026-05-01T00:00:00Z"),
  });
  const engagement = store.seedEngagement(trainee.id);
  const document = store.seedDocument({ engagementId: engagement.id, status: "draft", sentAt: null });
  const objectStorage = createPrivateObjectStore();
  objectStorage.objects.set(document.fileKey, Buffer.from("pdf"));
  let setupEmailInput: any;
  let offerEmailCalled = false;

  const sent = await sendOfferLetterDocument({
    storage: store as any,
    objectStorage,
    engagementId: engagement.id,
    documentId: document.id,
    actorAdminId: 99,
    sendEmail: async () => {
      offerEmailCalled = true;
      return true;
    },
    sendSetupEmail: async (input) => {
      setupEmailInput = input;
      return true;
    },
    now: new Date("2026-05-06T00:00:00Z"),
  });

  assert.equal(sent.status, "sent");
  assert.equal(offerEmailCalled, false);
  assert.equal(setupEmailInput.to, "deferred@example.com");
  assert.match(setupEmailInput.setupUrl, /\/set-password\?token=/);
  assert.match(setupEmailInput.workspaceUrl, /\/trainee$/);
  assert.doesNotMatch(JSON.stringify(setupEmailInput), /fileKey|signed|bearer|documentId|engagement-documents/i);
  assert.notEqual(store.admins.get(trainee.id).passwordSetupTokenHash, "old-hash");
  assert.deepEqual(
    store.events.slice(-2).map((event) => event.eventType),
    ["invitation_sent", "offer_letter_sent"],
  );
  assert.equal(store.events.at(-2).metadata.purpose, "trainee_offer_setup");
});

test("failed deferred setup email does not mark invitation or offer sent", async () => {
  const store = new MemoryOfferLetterStorage();
  const trainee = store.seedAdmin({
    email: "deferred-fail@example.com",
    mustChangePassword: true,
    passwordSetupTokenHash: "old-hash",
    passwordSetupExpiresAt: new Date("2026-05-01T00:00:00Z"),
  });
  const engagement = store.seedEngagement(trainee.id);
  const document = store.seedDocument({ engagementId: engagement.id, status: "draft", sentAt: null });
  const objectStorage = createPrivateObjectStore();
  objectStorage.objects.set(document.fileKey, Buffer.from("pdf"));
  let offerEmailCalled = false;

  await assert.rejects(
    sendOfferLetterDocument({
      storage: store as any,
      objectStorage,
      engagementId: engagement.id,
      documentId: document.id,
      actorAdminId: 99,
      sendEmail: async () => {
        offerEmailCalled = true;
        return true;
      },
      sendSetupEmail: async () => false,
      now: new Date("2026-05-06T00:00:00Z"),
    }),
    /Trainee setup email could not be sent/,
  );

  assert.equal(offerEmailCalled, false);
  assert.equal(store.documents.get(document.id).status, "draft");
  assert.equal(store.documents.get(document.id).sentAt, null);
  assert.equal(store.events.some((event) => event.eventType === "invitation_sent"), false);
  assert.equal(store.events.some((event) => event.eventType === "offer_letter_sent"), false);
});

test("resending offer does not spam setup email after setup invitation exists", async () => {
  const store = new MemoryOfferLetterStorage();
  const trainee = store.seedAdmin({
    email: "already-invited@example.com",
    mustChangePassword: true,
    passwordSetupTokenHash: "existing-hash",
  });
  const engagement = store.seedEngagement(trainee.id);
  const document = store.seedDocument({ engagementId: engagement.id, status: "sent" });
  const objectStorage = createPrivateObjectStore();
  objectStorage.objects.set(document.fileKey, Buffer.from("pdf"));
  await store.createAdminLifecycleEvent({
    adminUserId: trainee.id,
    engagementId: engagement.id,
    eventType: "invitation_sent",
    actorAdminId: 99,
    metadata: { channel: "email", purpose: "trainee_offer_setup" },
    notes: null,
  });
  let setupEmailCalls = 0;
  let offerEmailCalls = 0;

  const sent = await sendOfferLetterDocument({
    storage: store as any,
    objectStorage,
    engagementId: engagement.id,
    documentId: document.id,
    actorAdminId: 99,
    sendEmail: async () => {
      offerEmailCalls += 1;
      return true;
    },
    sendSetupEmail: async () => {
      setupEmailCalls += 1;
      return true;
    },
    now: new Date("2026-05-06T00:00:00Z"),
  });

  assert.equal(sent.status, "sent");
  assert.equal(setupEmailCalls, 0);
  assert.equal(offerEmailCalls, 1);
  assert.equal(store.events.filter((event) => event.eventType === "invitation_sent").length, 1);
});

test("accepted offer letter cannot be voided or regenerated and still gates onboarding readiness", async () => {
  const store = new MemoryOfferLetterStorage();
  const trainee = store.seedAdmin();
  const engagement = store.seedEngagement(trainee.id);
  const acceptedAt = new Date("2026-05-09T00:00:00Z");
  const document = store.seedDocument({
    engagementId: engagement.id,
    status: "accepted",
    acceptedAt,
    acceptedBy: trainee.id,
  });

  await assert.rejects(
    voidOfferLetterDocument({
      storage: store as any,
      engagementId: engagement.id,
      documentId: document.id,
      actorAdminId: 99,
    }),
    /cannot be voided/,
  );
  await assert.rejects(
    regenerateOfferLetterPdf({
      storage: store as any,
      objectStorage: createPrivateObjectStore(),
      engagementId: engagement.id,
      documentId: document.id,
      actorAdminId: 99,
    }),
    /cannot be regenerated/,
  );

  const stored = store.documents.get(document.id);
  assert.equal(stored.status, "accepted");
  assert.equal(stored.acceptedAt, acceptedAt);
  assert.equal(await store.hasAcceptedOfferLetterForEngagement(engagement.id), true);
});

test("failed artifact upload during create voids the partial document and allows clean retry", async () => {
  const store = new MemoryOfferLetterStorage();
  const trainee = store.seedAdmin();
  const engagement = store.seedEngagement(trainee.id);

  await withMutedConsoleError(async () => {
    await assert.rejects(
      createOfferLetterDocument({
        storage: store as any,
        objectStorage: createPrivateObjectStore({ failPut: true }),
        engagementId: engagement.id,
        actorAdminId: 99,
        title: "Offer Letter",
        body: "Body",
        now: new Date("2026-05-05T00:00:00Z"),
      }),
      (error: any) => (
        error instanceof OfferLetterError &&
        error.message === "Could not prepare the offer letter document." &&
        !/secret-bucket|private-r2|engagement-documents|PutObject/i.test(error.message)
      ),
    );
  });

  const [voided] = await store.listAdminEngagementDocuments(engagement.id);
  assert.equal(voided.status, "voided");
  assert.equal(voided.fileKey, null);
  assert.equal(voided.fileSha256, null);
  assert.ok(voided.voidedAt);
  assert.equal(store.events.at(-1).eventType, "offer_letter_voided");
  assert.deepEqual(store.events.at(-1).metadata.reason, "artifact_generation_failed");
  assert.equal(
    store.events.some((event) => /secret-bucket|private-r2|engagement-documents/i.test(JSON.stringify(event.metadata))),
    false,
  );

  const retried = await createOfferLetterDocument({
    storage: store as any,
    objectStorage: createPrivateObjectStore(),
    engagementId: engagement.id,
    actorAdminId: 99,
    title: "Offer Letter Retry",
    body: "Retry body",
    now: new Date("2026-05-06T00:00:00Z"),
  });

  assert.equal(retried.status, "draft");
  assert.equal(retried.version, 2);
  assert.ok(retried.fileKey);
  assert.equal(
    (await store.listAdminEngagementDocuments(engagement.id)).filter((doc) => doc.status !== "voided").length,
    1,
  );
});

test("resending viewed offer preserves viewed status and does not duplicate viewed events", async () => {
  const store = new MemoryOfferLetterStorage();
  const trainee = store.seedAdmin({ email: "trainee@example.com" });
  const engagement = store.seedEngagement(trainee.id);
  const document = store.seedDocument({ engagementId: engagement.id, status: "sent" });
  const objectStorage = createPrivateObjectStore();
  objectStorage.objects.set(document.fileKey, Buffer.from("pdf"));

  await viewOfferLetterForTrainee({
    storage: store as any,
    adminUserId: trainee.id,
    documentId: document.id,
    now: new Date("2026-05-07T00:00:00Z"),
  });
  const resent = await sendOfferLetterDocument({
    storage: store as any,
    objectStorage,
    engagementId: engagement.id,
    documentId: document.id,
    actorAdminId: 99,
    sendEmail: async () => true,
    now: new Date("2026-05-07T01:00:00Z"),
  });
  await viewOfferLetterForTrainee({
    storage: store as any,
    adminUserId: trainee.id,
    documentId: document.id,
    now: new Date("2026-05-07T02:00:00Z"),
  });

  assert.equal(resent.status, "viewed");
  assert.equal(store.documents.get(document.id).status, "viewed");
  assert.equal(store.events.filter((event) => event.eventType === "offer_letter_viewed").length, 1);
  assert.equal(store.events.at(-1).eventType, "offer_letter_sent");
  assert.equal(store.events.at(-1).metadata.resend, true);
});

test("send regenerates a missing private object before email", async () => {
  const store = new MemoryOfferLetterStorage();
  const trainee = store.seedAdmin({ email: "trainee@example.com" });
  const engagement = store.seedEngagement(trainee.id);
  const document = store.seedDocument({
    engagementId: engagement.id,
    status: "sent",
    fileKey: "engagement-documents/missing.pdf",
    fileSha256: "stale-hash",
  });
  const objectStorage = createPrivateObjectStore();
  let emailSent = false;

  const sent = await sendOfferLetterDocument({
    storage: store as any,
    objectStorage,
    engagementId: engagement.id,
    documentId: document.id,
    actorAdminId: 99,
    sendEmail: async () => {
      emailSent = true;
      return true;
    },
    now: new Date("2026-05-10T00:00:00Z"),
  });

  assert.equal(emailSent, true);
  assert.equal(sent.status, "sent");
  assert.equal(objectStorage.putCount, 1);
  assert.equal(objectStorage.objects.has(sent.fileKey), true);
  assert.notEqual(sent.fileSha256, "stale-hash");
  assert.deepEqual(
    store.events.slice(-2).map((event) => event.eventType),
    ["offer_letter_pdf_generated", "offer_letter_sent"],
  );
});

test("send missing object with regeneration failure does not email or mark sent", async () => {
  const store = new MemoryOfferLetterStorage();
  const trainee = store.seedAdmin({ email: "trainee@example.com" });
  const engagement = store.seedEngagement(trainee.id);
  const document = store.seedDocument({
    engagementId: engagement.id,
    status: "draft",
    sentAt: null,
    fileKey: "engagement-documents/missing.pdf",
    fileSha256: "stale-hash",
  });
  let emailSent = false;

  await withMutedConsoleError(async () => {
    await assert.rejects(
      sendOfferLetterDocument({
        storage: store as any,
        objectStorage: createPrivateObjectStore({ failPut: true }),
        engagementId: engagement.id,
        documentId: document.id,
        actorAdminId: 99,
        sendEmail: async () => {
          emailSent = true;
          return true;
        },
        now: new Date("2026-05-10T00:00:00Z"),
      }),
      /Could not prepare the offer letter document/,
    );
  });

  assert.equal(emailSent, false);
  assert.equal(store.documents.get(document.id).status, "draft");
  assert.equal(store.documents.get(document.id).sentAt, null);
  assert.equal(store.events.some((event) => event.eventType === "offer_letter_sent"), false);
});

test("storage failures return generic client-safe service errors", async () => {
  const store = new MemoryOfferLetterStorage();
  const trainee = store.seedAdmin();
  const engagement = store.seedEngagement(trainee.id);
  const document = store.seedDocument({ engagementId: engagement.id });

  await withMutedConsoleError(async () => {
    await assert.rejects(
      getOfferLetterDownload({
        storage: store as any,
        objectStorage: createPrivateObjectStore({ failGet: true }),
        requester: "trainee",
        adminUserId: trainee.id,
        documentId: document.id,
      }),
      (error: any) => (
        error instanceof OfferLetterError &&
        error.message === "Document artifact is not available. Please try again or regenerate the offer letter." &&
        !/secret-bucket|private-r2|engagement-documents|GetObject|stack/i.test(error.message)
      ),
    );

    await assert.rejects(
      sendOfferLetterDocument({
        storage: store as any,
        objectStorage: createPrivateObjectStore({ failExists: true }),
        engagementId: engagement.id,
        documentId: document.id,
        actorAdminId: 99,
        sendEmail: async () => true,
      }),
      (error: any) => (
        error instanceof OfferLetterError &&
        error.message === "Document artifact is not available. Please try again or regenerate the offer letter." &&
        !/secret-bucket|private-r2|engagement-documents|HeadObject|stack/i.test(error.message)
      ),
    );
  });
});

test("trainee cannot accept or download another trainee document by guessed id", async () => {
  const store = new MemoryOfferLetterStorage();
  const first = store.seedAdmin();
  const second = store.seedAdmin();
  const engagement = store.seedEngagement(first.id);
  const document = store.seedDocument({ engagementId: engagement.id });

  await assert.rejects(
    acceptOfferLetterForTrainee({
      storage: store as any,
      adminUserId: second.id,
      documentId: document.id,
    }),
    /not found/,
  );

  await assert.rejects(
    getOfferLetterDownload({
      storage: store as any,
      objectStorage: createPrivateObjectStore(),
      requester: "trainee",
      adminUserId: second.id,
      documentId: document.id,
    }),
    /not found/,
  );
});

test("offer letter view is idempotent and writes one viewed event", async () => {
  const store = new MemoryOfferLetterStorage();
  const trainee = store.seedAdmin();
  const engagement = store.seedEngagement(trainee.id);
  const document = store.seedDocument({ engagementId: engagement.id, status: "sent" });

  await viewOfferLetterForTrainee({
    storage: store as any,
    adminUserId: trainee.id,
    documentId: document.id,
    now: new Date("2026-05-07T00:00:00Z"),
  });
  await viewOfferLetterForTrainee({
    storage: store as any,
    adminUserId: trainee.id,
    documentId: document.id,
    now: new Date("2026-05-07T01:00:00Z"),
  });

  assert.equal(store.documents.get(document.id).status, "viewed");
  assert.equal(store.events.filter((event) => event.eventType === "offer_letter_viewed").length, 1);
});

test("offer letter acceptance is idempotent and writes one accepted event", async () => {
  const store = new MemoryOfferLetterStorage();
  const trainee = store.seedAdmin();
  const engagement = store.seedEngagement(trainee.id);
  const document = store.seedDocument({ engagementId: engagement.id, status: "viewed" });

  const first = await acceptOfferLetterForTrainee({
    storage: store as any,
    adminUserId: trainee.id,
    documentId: document.id,
    ip: "203.0.113.10",
    userAgent: "test-agent",
    now: new Date("2026-05-08T00:00:00Z"),
  });
  const second = await acceptOfferLetterForTrainee({
    storage: store as any,
    adminUserId: trainee.id,
    documentId: document.id,
    ip: "203.0.113.11",
    userAgent: "different-agent",
    now: new Date("2026-05-08T01:00:00Z"),
  });

  assert.equal(first.status, "accepted");
  assert.equal(second.acceptedIp, "203.0.113.10");
  assert.equal(second.acceptedUserAgent, "test-agent");
  assert.equal(store.events.filter((event) => event.eventType === "offer_letter_accepted").length, 1);
});

test("offer letter acceptance rejects voided declined draft and missing documents", async () => {
  for (const status of ["voided", "declined", "draft"]) {
    const store = new MemoryOfferLetterStorage();
    const trainee = store.seedAdmin();
    const engagement = store.seedEngagement(trainee.id);
    const document = store.seedDocument({ engagementId: engagement.id, status });

    await assert.rejects(
      acceptOfferLetterForTrainee({
        storage: store as any,
        adminUserId: trainee.id,
        documentId: document.id,
      }),
      /offer letter|Only sent or viewed/,
    );
  }

  const store = new MemoryOfferLetterStorage();
  const trainee = store.seedAdmin();
  await assert.rejects(
    acceptOfferLetterForTrainee({
      storage: store as any,
      adminUserId: trainee.id,
      documentId: 999,
    }),
    /not found/,
  );
});

test("offer letter download returns private object bytes instead of public URLs", async () => {
  const store = new MemoryOfferLetterStorage();
  const trainee = store.seedAdmin();
  const engagement = store.seedEngagement(trainee.id);
  const document = store.seedDocument({ engagementId: engagement.id });
  const objectStorage = createPrivateObjectStore();
  objectStorage.objects.set(document.fileKey, Buffer.from("%PDF-private"));

  const result = await getOfferLetterDownload({
    storage: store as any,
    objectStorage,
    requester: "trainee",
    adminUserId: trainee.id,
    documentId: document.id,
  });

  assert.equal(result.object.buffer.toString(), "%PDF-private");
  assert.equal(result.object.contentType, "application/pdf");
  assert.equal(result.filename, "offer-letter-v1.pdf");
});
