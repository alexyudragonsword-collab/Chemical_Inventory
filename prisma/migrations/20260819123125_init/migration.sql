-- CreateEnum
CREATE TYPE "Role" AS ENUM ('VIEWER', 'LAB_USER', 'CUSTODIAN', 'LAB_MANAGER', 'EHS_OFFICER', 'ADMIN');

-- CreateEnum
CREATE TYPE "LocationKind" AS ENUM ('CABINET', 'SHELF', 'FRIDGE', 'ROOM', 'OTHER');

-- CreateEnum
CREATE TYPE "GhsPictogram" AS ENUM ('GHS01_EXPLOSIVE', 'GHS02_FLAMMABLE', 'GHS03_OXIDISER', 'GHS04_GAS', 'GHS05_CORROSIVE', 'GHS06_TOXIC', 'GHS07_IRRITANT', 'GHS08_HEALTH_HAZARD', 'GHS09_ENVIRONMENT');

-- CreateEnum
CREATE TYPE "SignalWord" AS ENUM ('DANGER', 'WARNING', 'NONE');

-- CreateEnum
CREATE TYPE "ClassificationSource" AS ENUM ('SUPPLIER_SDS', 'AUTO_DERIVED', 'LOCAL_EHS_RULE');

-- CreateEnum
CREATE TYPE "CompatibilityVerdict" AS ENUM ('COMPATIBLE', 'SEGREGATE', 'NEVER_TOGETHER');

-- CreateEnum
CREATE TYPE "CanonicalUnit" AS ENUM ('MG', 'G', 'KG', 'ML', 'L', 'UNIT');

-- CreateEnum
CREATE TYPE "ContainerStatus" AS ENUM ('ACTIVE', 'EMPTY', 'DISPOSED', 'MISSING', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "TransactionKind" AS ENUM ('CHECK_IN', 'ADD', 'DEDUCT', 'CORRECT', 'TRANSFER', 'DISPOSE', 'REVERSAL');

-- CreateEnum
CREATE TYPE "TransferRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "StocktakeStatus" AS ENUM ('OPEN', 'PAUSED', 'AWAITING_SIGNOFF', 'SIGNED_OFF', 'ABANDONED');

-- CreateEnum
CREATE TYPE "DiscrepancyKind" AS ENUM ('NONE', 'MISMATCH', 'MISSING', 'UNEXPECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "DiscrepancyResolution" AS ENUM ('CORRECTED', 'CLAIMED', 'ANNOTATED');

-- CreateEnum
CREATE TYPE "AlertKind" AS ENUM ('EXPIRED', 'EXPIRING_SOON', 'BELOW_MIN', 'SDS_UNREAD', 'COMPAT_CONFLICT', 'QUANTITY_DRIFT');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED', 'SNOOZED');

-- CreateEnum
CREATE TYPE "SdsStatus" AS ENUM ('CURRENT', 'SUPERSEDED', 'EXPIRED', 'MISSING');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('DRY_RUN', 'APPLIED', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportRowDisposition" AS ENUM ('IMPORTED', 'MERGED_DUPLICATE', 'SKIPPED_PLACEHOLDER', 'SKIPPED_STRUCTURAL', 'ERROR');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" "Role" NOT NULL DEFAULT 'LAB_USER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "tokenVersion" INTEGER NOT NULL DEFAULT 1,
    "totpSecret" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_provider" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,

    CONSTRAINT "auth_provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "isManager" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "lab_membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "lab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_location" (
    "id" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "parentId" TEXT,
    "kind" "LocationKind" NOT NULL DEFAULT 'OTHER',
    "code" TEXT NOT NULL,
    "name" TEXT,
    "capacity" INTEGER,
    "maxVolumeL" DECIMAL(65,30),
    "rawAliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "incomplete" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "storage_location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "substance" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "casNumber" TEXT,
    "ecNumber" TEXT,
    "unNumber" TEXT,
    "molecularFormula" TEXT,
    "legacyHazardCode" TEXT,
    "minStockLevel" DECIMAL(65,30),
    "minStockUnit" "CanonicalUnit",
    "isControlled" BOOLEAN NOT NULL DEFAULT false,
    "needsCasEnrichment" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "substance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_product" (
    "id" TEXT NOT NULL,
    "substanceId" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "catalogNumber" TEXT NOT NULL,

    CONSTRAINT "supplier_product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ghs_classification" (
    "id" TEXT NOT NULL,
    "substanceId" TEXT NOT NULL,
    "pictograms" "GhsPictogram"[] DEFAULT ARRAY[]::"GhsPictogram"[],
    "signalWord" "SignalWord" NOT NULL DEFAULT 'NONE',
    "storageClass" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ghs_classification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "h_statement" (
    "code" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "hazardCategory" TEXT,

    CONSTRAINT "h_statement_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "p_statement" (
    "code" TEXT NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "p_statement_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "h_statement_on_classification" (
    "classificationId" TEXT NOT NULL,
    "hCode" TEXT NOT NULL,
    "source" "ClassificationSource" NOT NULL DEFAULT 'SUPPLIER_SDS',
    "needsReview" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "h_statement_on_classification_pkey" PRIMARY KEY ("classificationId","hCode")
);

-- CreateTable
CREATE TABLE "p_statement_on_classification" (
    "classificationId" TEXT NOT NULL,
    "pCode" TEXT NOT NULL,
    "source" "ClassificationSource" NOT NULL DEFAULT 'SUPPLIER_SDS',

    CONSTRAINT "p_statement_on_classification_pkey" PRIMARY KEY ("classificationId","pCode")
);

-- CreateTable
CREATE TABLE "compatibility_rule" (
    "id" TEXT NOT NULL,
    "classA" TEXT NOT NULL,
    "classB" TEXT NOT NULL,
    "verdict" "CompatibilityVerdict" NOT NULL,

    CONSTRAINT "compatibility_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permit_category" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "permit_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "container_permit_category" (
    "containerId" TEXT NOT NULL,
    "permitCategoryId" TEXT NOT NULL,
    "permitCode" TEXT,

    CONSTRAINT "container_permit_category_pkey" PRIMARY KEY ("containerId","permitCategoryId")
);

-- CreateTable
CREATE TABLE "container" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "substanceId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "locationId" TEXT,
    "custodianId" TEXT,
    "currentQuantity" DECIMAL(65,30) NOT NULL,
    "initialQuantity" DECIMAL(65,30) NOT NULL,
    "unit" "CanonicalUnit" NOT NULL,
    "lotNumber" TEXT,
    "grade" TEXT,
    "expiryDate" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "status" "ContainerStatus" NOT NULL DEFAULT 'ACTIVE',
    "useFirst" BOOLEAN NOT NULL DEFAULT false,
    "pendingCorrection" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "container_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_event" (
    "id" TEXT NOT NULL,
    "seq" BIGINT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorId" TEXT,
    "onBehalfSystem" BOOLEAN NOT NULL DEFAULT false,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "witnessId" TEXT,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_transaction" (
    "id" TEXT NOT NULL,
    "auditEventId" TEXT NOT NULL,
    "containerId" TEXT NOT NULL,
    "kind" "TransactionKind" NOT NULL,
    "quantityBefore" DECIMAL(65,30) NOT NULL,
    "quantityAfter" DECIMAL(65,30) NOT NULL,
    "unit" "CanonicalUnit" NOT NULL,
    "reason" TEXT NOT NULL,
    "projectCode" TEXT,
    "reversedById" TEXT,
    "reversibleUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_request" (
    "id" TEXT NOT NULL,
    "containerId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "currentCustodianId" TEXT,
    "status" "TransferRequestStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfer_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stocktake_session" (
    "id" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "startedById" TEXT NOT NULL,
    "status" "StocktakeStatus" NOT NULL DEFAULT 'OPEN',
    "signedOffById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signedOffAt" TIMESTAMP(3),

    CONSTRAINT "stocktake_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stocktake_count" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "containerId" TEXT,
    "scannedCode" TEXT NOT NULL,
    "locationId" TEXT,
    "countedQuantity" DECIMAL(65,30),
    "countedById" TEXT NOT NULL,
    "discrepancy" "DiscrepancyKind" NOT NULL DEFAULT 'NONE',
    "resolution" "DiscrepancyResolution",
    "note" TEXT,
    "countedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stocktake_count_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert" (
    "id" TEXT NOT NULL,
    "kind" "AlertKind" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "labId" TEXT,
    "containerId" TEXT,
    "substanceId" TEXT,
    "locationId" TEXT,
    "detail" JSONB NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "snoozedUntil" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_threshold_setting" (
    "id" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "expiryWarningDays" INTEGER NOT NULL DEFAULT 30,
    "lowStockPercent" INTEGER NOT NULL DEFAULT 25,
    "sdsRereadDays" INTEGER NOT NULL DEFAULT 14,

    CONSTRAINT "alert_threshold_setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sds_document" (
    "id" TEXT NOT NULL,
    "substanceId" TEXT NOT NULL,
    "supplier" TEXT,
    "revision" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'EN',
    "issuedDate" TIMESTAMP(3),
    "fileKey" TEXT,
    "status" "SdsStatus" NOT NULL DEFAULT 'CURRENT',
    "supersedesId" TEXT,
    "changeSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sds_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sds_read_receipt" (
    "id" TEXT NOT NULL,
    "sdsDocumentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sds_read_receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batch" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "status" "ImportBatchStatus" NOT NULL,
    "stats" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_row" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "sheetName" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "subId" TEXT,
    "disposition" "ImportRowDisposition" NOT NULL,
    "containerId" TEXT,
    "notes" TEXT,

    CONSTRAINT "import_row_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_run" (
    "id" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN,
    "summary" JSONB,
    "error" TEXT,

    CONSTRAINT "job_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "auth_provider_provider_providerAccountId_key" ON "auth_provider"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "lab_membership_userId_labId_key" ON "lab_membership"("userId", "labId");

-- CreateIndex
CREATE UNIQUE INDEX "site_name_key" ON "site"("name");

-- CreateIndex
CREATE UNIQUE INDEX "lab_code_key" ON "lab"("code");

-- CreateIndex
CREATE UNIQUE INDEX "storage_location_labId_code_key" ON "storage_location"("labId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "substance_casNumber_key" ON "substance"("casNumber");

-- CreateIndex
CREATE INDEX "substance_name_idx" ON "substance"("name");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_product_substanceId_supplier_catalogNumber_key" ON "supplier_product"("substanceId", "supplier", "catalogNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ghs_classification_substanceId_key" ON "ghs_classification"("substanceId");

-- CreateIndex
CREATE UNIQUE INDEX "compatibility_rule_classA_classB_key" ON "compatibility_rule"("classA", "classB");

-- CreateIndex
CREATE UNIQUE INDEX "permit_category_code_key" ON "permit_category"("code");

-- CreateIndex
CREATE UNIQUE INDEX "container_code_key" ON "container"("code");

-- CreateIndex
CREATE INDEX "container_substanceId_idx" ON "container"("substanceId");

-- CreateIndex
CREATE INDEX "container_labId_status_idx" ON "container"("labId", "status");

-- CreateIndex
CREATE INDEX "container_custodianId_idx" ON "container"("custodianId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_event_seq_key" ON "audit_event"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "audit_event_prevHash_key" ON "audit_event"("prevHash");

-- CreateIndex
CREATE INDEX "audit_event_entityType_entityId_idx" ON "audit_event"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_event_createdAt_idx" ON "audit_event"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_transaction_auditEventId_key" ON "inventory_transaction"("auditEventId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_transaction_reversedById_key" ON "inventory_transaction"("reversedById");

-- CreateIndex
CREATE INDEX "inventory_transaction_containerId_createdAt_idx" ON "inventory_transaction"("containerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "project_code_key" ON "project"("code");

-- CreateIndex
CREATE INDEX "transfer_request_currentCustodianId_status_idx" ON "transfer_request"("currentCustodianId", "status");

-- CreateIndex
CREATE INDEX "transfer_request_requesterId_idx" ON "transfer_request"("requesterId");

-- CreateIndex
CREATE UNIQUE INDEX "stocktake_count_sessionId_scannedCode_key" ON "stocktake_count"("sessionId", "scannedCode");

-- CreateIndex
CREATE UNIQUE INDEX "alert_dedupeKey_key" ON "alert"("dedupeKey");

-- CreateIndex
CREATE INDEX "alert_status_kind_idx" ON "alert"("status", "kind");

-- CreateIndex
CREATE INDEX "alert_labId_status_idx" ON "alert"("labId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "alert_threshold_setting_labId_key" ON "alert_threshold_setting"("labId");

-- CreateIndex
CREATE UNIQUE INDEX "sds_document_supersedesId_key" ON "sds_document"("supersedesId");

-- CreateIndex
CREATE INDEX "sds_document_substanceId_status_idx" ON "sds_document"("substanceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sds_read_receipt_sdsDocumentId_userId_key" ON "sds_read_receipt"("sdsDocumentId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "import_batch_fileHash_key" ON "import_batch"("fileHash");

-- CreateIndex
CREATE INDEX "job_run_jobName_startedAt_idx" ON "job_run"("jobName", "startedAt");

-- AddForeignKey
ALTER TABLE "auth_provider" ADD CONSTRAINT "auth_provider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_membership" ADD CONSTRAINT "lab_membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_membership" ADD CONSTRAINT "lab_membership_labId_fkey" FOREIGN KEY ("labId") REFERENCES "lab"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab" ADD CONSTRAINT "lab_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_location" ADD CONSTRAINT "storage_location_labId_fkey" FOREIGN KEY ("labId") REFERENCES "lab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_location" ADD CONSTRAINT "storage_location_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "storage_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_product" ADD CONSTRAINT "supplier_product_substanceId_fkey" FOREIGN KEY ("substanceId") REFERENCES "substance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ghs_classification" ADD CONSTRAINT "ghs_classification_substanceId_fkey" FOREIGN KEY ("substanceId") REFERENCES "substance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "h_statement_on_classification" ADD CONSTRAINT "h_statement_on_classification_classificationId_fkey" FOREIGN KEY ("classificationId") REFERENCES "ghs_classification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "h_statement_on_classification" ADD CONSTRAINT "h_statement_on_classification_hCode_fkey" FOREIGN KEY ("hCode") REFERENCES "h_statement"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "p_statement_on_classification" ADD CONSTRAINT "p_statement_on_classification_classificationId_fkey" FOREIGN KEY ("classificationId") REFERENCES "ghs_classification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "p_statement_on_classification" ADD CONSTRAINT "p_statement_on_classification_pCode_fkey" FOREIGN KEY ("pCode") REFERENCES "p_statement"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "container_permit_category" ADD CONSTRAINT "container_permit_category_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "container"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "container_permit_category" ADD CONSTRAINT "container_permit_category_permitCategoryId_fkey" FOREIGN KEY ("permitCategoryId") REFERENCES "permit_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "container" ADD CONSTRAINT "container_substanceId_fkey" FOREIGN KEY ("substanceId") REFERENCES "substance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "container" ADD CONSTRAINT "container_labId_fkey" FOREIGN KEY ("labId") REFERENCES "lab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "container" ADD CONSTRAINT "container_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "storage_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "container" ADD CONSTRAINT "container_custodianId_fkey" FOREIGN KEY ("custodianId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_witnessId_fkey" FOREIGN KEY ("witnessId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transaction" ADD CONSTRAINT "inventory_transaction_auditEventId_fkey" FOREIGN KEY ("auditEventId") REFERENCES "audit_event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transaction" ADD CONSTRAINT "inventory_transaction_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "container"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transaction" ADD CONSTRAINT "inventory_transaction_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "inventory_transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_request" ADD CONSTRAINT "transfer_request_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "container"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_session" ADD CONSTRAINT "stocktake_session_labId_fkey" FOREIGN KEY ("labId") REFERENCES "lab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_count" ADD CONSTRAINT "stocktake_count_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "stocktake_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_count" ADD CONSTRAINT "stocktake_count_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "container"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert" ADD CONSTRAINT "alert_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "container"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_threshold_setting" ADD CONSTRAINT "alert_threshold_setting_labId_fkey" FOREIGN KEY ("labId") REFERENCES "lab"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sds_document" ADD CONSTRAINT "sds_document_substanceId_fkey" FOREIGN KEY ("substanceId") REFERENCES "substance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sds_document" ADD CONSTRAINT "sds_document_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "sds_document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sds_read_receipt" ADD CONSTRAINT "sds_read_receipt_sdsDocumentId_fkey" FOREIGN KEY ("sdsDocumentId") REFERENCES "sds_document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sds_read_receipt" ADD CONSTRAINT "sds_read_receipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "import_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "container"("id") ON DELETE SET NULL ON UPDATE CASCADE;
