-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('SUPPLIER', 'RECIPIENT', 'LOGISTICS_PARTNER', 'ADMIN_HQ');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'SUPPLIER', 'MITRA');

-- CreateEnum
CREATE TYPE "FoodCategory" AS ENUM ('COOKED_MEALS', 'BAKERY_PASTRY', 'DAIRY_EGGS', 'FRESH_PRODUCE', 'PACKAGED_DRY', 'BEVERAGES');

-- CreateEnum
CREATE TYPE "FoodCondition" AS ENUM ('FRESH', 'SLIGHTLY_WILTED', 'NEAR_EXPIRY', 'DAMAGED_PACKAGING', 'SPOILED');

-- CreateEnum
CREATE TYPE "PackagingStatus" AS ENUM ('INTACT_SEALED', 'RESEALED', 'OPENED_EXPOSED', 'DAMAGED');

-- CreateEnum
CREATE TYPE "ListingLifecycleStatus" AS ENUM ('REPORTED', 'ASSESSED', 'MATCHED', 'CANCELLED', 'EXPIRED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "FoodSafetyStatus" AS ENUM ('PASS', 'REVIEW', 'REJECT');

-- CreateEnum
CREATE TYPE "RouteHierarchy" AS ENUM ('REDISTRIBUTE', 'PROCESS', 'ANIMAL_FEED', 'ORGANIC', 'SAFE_DISPOSAL');

-- CreateEnum
CREATE TYPE "RecipientType" AS ENUM ('COMMUNITY_KITCHEN', 'FOOD_BANK', 'ORPHANAGE', 'COMPOST_FACILITY');

-- CreateEnum
CREATE TYPE "JourneyStatus" AS ENUM ('MATCHED', 'RESCUE_INITIATED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'STATUS_CHANGE', 'CANCEL', 'PHYSICAL_REJECTION', 'DELETE');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" "OrganizationType" NOT NULL,
    "address" TEXT NOT NULL,
    "contact_phone" VARCHAR(50),
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "full_name" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "is_revoked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_types" (
    "id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name_id" VARCHAR(255) NOT NULL,
    "name_en" VARCHAR(255) NOT NULL,
    "default_category" "FoodCategory" NOT NULL,
    "max_safe_hours" DECIMAL(5,2) NOT NULL,
    "recommended_temp_min_c" DECIMAL(4,1),
    "recommended_temp_max_c" DECIMAL(4,1),
    "is_perishable" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "food_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surplus_listings" (
    "id" UUID NOT NULL,
    "donor_organization_id" UUID NOT NULL,
    "reporter_user_id" UUID NOT NULL,
    "food_type_id" UUID,
    "food_name" VARCHAR(255) NOT NULL,
    "food_category" "FoodCategory" NOT NULL,
    "quantity_kg" DECIMAL(10,2) NOT NULL,
    "portions" INTEGER NOT NULL,
    "condition" "FoodCondition" NOT NULL,
    "storage_temperature_c" DECIMAL(4,1),
    "packaging_status" "PackagingStatus" NOT NULL,
    "hygiene_score" INTEGER NOT NULL,
    "prepared_at" TIMESTAMP(3) NOT NULL,
    "safe_until_timestamp" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "current_lifecycle_status" "ListingLifecycleStatus" NOT NULL DEFAULT 'REPORTED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surplus_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_safety_assessments" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "safety_status" "FoodSafetyStatus" NOT NULL,
    "gate_reasons" JSONB NOT NULL,
    "storage_history_known" BOOLEAN NOT NULL DEFAULT true,
    "is_expired" BOOLEAN NOT NULL DEFAULT false,
    "has_spoilage_signs" BOOLEAN NOT NULL DEFAULT false,
    "packaging_damaged" BOOLEAN NOT NULL DEFAULT false,
    "hygiene_adequate" BOOLEAN NOT NULL DEFAULT true,
    "temp_abuse_detected" BOOLEAN NOT NULL DEFAULT false,
    "assessed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "food_safety_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rescue_score_assessments" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "total_score" DECIMAL(5,2) NOT NULL,
    "condition_subscore" DECIMAL(5,2) NOT NULL,
    "urgency_subscore" DECIMAL(5,2) NOT NULL,
    "quantity_subscore" DECIMAL(5,2) NOT NULL,
    "ease_subscore" DECIMAL(5,2) NOT NULL,
    "destination_fit_subscore" DECIMAL(5,2) NOT NULL,
    "recommended_route" "RouteHierarchy" NOT NULL,
    "score_breakdown" JSONB NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rescue_score_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipient_profiles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "recipient_type" "RecipientType" NOT NULL,
    "accepted_food_categories" JSONB NOT NULL,
    "has_refrigeration" BOOLEAN NOT NULL DEFAULT false,
    "has_freezer" BOOLEAN NOT NULL DEFAULT false,
    "daily_max_capacity_kg" DECIMAL(10,2) NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipient_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipient_capacities" (
    "id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "capacity_date" DATE NOT NULL,
    "max_capacity_kg" DECIMAL(10,2) NOT NULL,
    "allocated_capacity_kg" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "received_capacity_kg" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "available_capacity_kg" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipient_capacities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rescue_journeys" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "current_status" "JourneyStatus" NOT NULL DEFAULT 'MATCHED',
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "initiated_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,
    "estimated_transit_minutes" INTEGER,
    "actual_received_kg" DECIMAL(10,2),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rescue_journeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journey_timeline_events" (
    "id" UUID NOT NULL,
    "journey_id" UUID NOT NULL,
    "status" "JourneyStatus" NOT NULL,
    "note" TEXT,
    "actor_user_id" UUID,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journey_timeline_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "table_name" VARCHAR(100) NOT NULL,
    "record_id" UUID NOT NULL,
    "action" "AuditAction" NOT NULL,
    "actor_user_id" UUID,
    "previous_state" JSONB,
    "new_state" JSONB,
    "reason" TEXT,
    "ip_address" VARCHAR(45),
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_organization_id_idx" ON "users"("organization_id");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_token_hash_idx" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "food_types_code_key" ON "food_types"("code");

-- CreateIndex
CREATE INDEX "surplus_listings_donor_organization_id_idx" ON "surplus_listings"("donor_organization_id");

-- CreateIndex
CREATE INDEX "surplus_listings_current_lifecycle_status_idx" ON "surplus_listings"("current_lifecycle_status");

-- CreateIndex
CREATE INDEX "surplus_listings_safe_until_timestamp_idx" ON "surplus_listings"("safe_until_timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "food_safety_assessments_listing_id_key" ON "food_safety_assessments"("listing_id");

-- CreateIndex
CREATE INDEX "food_safety_assessments_safety_status_idx" ON "food_safety_assessments"("safety_status");

-- CreateIndex
CREATE UNIQUE INDEX "rescue_score_assessments_listing_id_key" ON "rescue_score_assessments"("listing_id");

-- CreateIndex
CREATE INDEX "rescue_score_assessments_total_score_idx" ON "rescue_score_assessments"("total_score");

-- CreateIndex
CREATE INDEX "rescue_score_assessments_recommended_route_idx" ON "rescue_score_assessments"("recommended_route");

-- CreateIndex
CREATE UNIQUE INDEX "recipient_profiles_organization_id_key" ON "recipient_profiles"("organization_id");

-- CreateIndex
CREATE INDEX "recipient_capacities_capacity_date_idx" ON "recipient_capacities"("capacity_date");

-- CreateIndex
CREATE UNIQUE INDEX "recipient_capacities_recipient_id_capacity_date_key" ON "recipient_capacities"("recipient_id", "capacity_date");

-- CreateIndex
CREATE INDEX "rescue_journeys_listing_id_idx" ON "rescue_journeys"("listing_id");

-- CreateIndex
CREATE INDEX "rescue_journeys_recipient_id_idx" ON "rescue_journeys"("recipient_id");

-- CreateIndex
CREATE INDEX "rescue_journeys_current_status_idx" ON "rescue_journeys"("current_status");

-- CreateIndex
CREATE INDEX "journey_timeline_events_journey_id_idx" ON "journey_timeline_events"("journey_id");

-- CreateIndex
CREATE INDEX "audit_logs_table_name_record_id_idx" ON "audit_logs"("table_name", "record_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_idx" ON "audit_logs"("actor_user_id");

-- CreateIndex
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs"("timestamp");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surplus_listings" ADD CONSTRAINT "surplus_listings_donor_organization_id_fkey" FOREIGN KEY ("donor_organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surplus_listings" ADD CONSTRAINT "surplus_listings_reporter_user_id_fkey" FOREIGN KEY ("reporter_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surplus_listings" ADD CONSTRAINT "surplus_listings_food_type_id_fkey" FOREIGN KEY ("food_type_id") REFERENCES "food_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_safety_assessments" ADD CONSTRAINT "food_safety_assessments_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "surplus_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rescue_score_assessments" ADD CONSTRAINT "rescue_score_assessments_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "surplus_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipient_profiles" ADD CONSTRAINT "recipient_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipient_capacities" ADD CONSTRAINT "recipient_capacities_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "recipient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rescue_journeys" ADD CONSTRAINT "rescue_journeys_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "surplus_listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rescue_journeys" ADD CONSTRAINT "rescue_journeys_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "recipient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_timeline_events" ADD CONSTRAINT "journey_timeline_events_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "rescue_journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_timeline_events" ADD CONSTRAINT "journey_timeline_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
