-- CreateEnum
CREATE TYPE "EmergencyUrgencyLevel" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM');

-- CreateEnum
CREATE TYPE "EmergencyRequestStatus" AS ENUM ('OPEN', 'ALLOCATED', 'FULFILLED', 'CANCELLED');

-- AlterTable
ALTER TABLE "surplus_listings" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "is_deleted" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "emergency_food_requests" (
    "id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "requester_user_id" UUID NOT NULL,
    "needed_food_type" VARCHAR(100) NOT NULL,
    "food_type_name" VARCHAR(255) NOT NULL,
    "requested_portions" INTEGER NOT NULL,
    "estimated_kg" DECIMAL(10,2) NOT NULL,
    "beneficiary_count" INTEGER NOT NULL,
    "beneficiary_group" VARCHAR(255) NOT NULL,
    "target_location" TEXT NOT NULL,
    "urgency_level" "EmergencyUrgencyLevel" NOT NULL,
    "urgency_deadline" VARCHAR(255) NOT NULL,
    "urgency_reason" TEXT NOT NULL,
    "contact_person" VARCHAR(255) NOT NULL,
    "contact_phone" VARCHAR(50) NOT NULL,
    "notes" TEXT,
    "status" "EmergencyRequestStatus" NOT NULL DEFAULT 'OPEN',
    "matched_surplus_id" UUID,
    "cancel_reason" TEXT,
    "matched_at" TIMESTAMP(3),
    "fulfilled_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "emergency_food_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "emergency_food_requests_status_urgency_level_idx" ON "emergency_food_requests"("status", "urgency_level");

-- CreateIndex
CREATE INDEX "emergency_food_requests_recipient_id_idx" ON "emergency_food_requests"("recipient_id");

-- CreateIndex
CREATE INDEX "emergency_food_requests_is_deleted_idx" ON "emergency_food_requests"("is_deleted");

-- CreateIndex
CREATE INDEX "surplus_listings_is_deleted_idx" ON "surplus_listings"("is_deleted");

-- AddForeignKey
ALTER TABLE "emergency_food_requests" ADD CONSTRAINT "emergency_food_requests_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "recipient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_food_requests" ADD CONSTRAINT "emergency_food_requests_requester_user_id_fkey" FOREIGN KEY ("requester_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_food_requests" ADD CONSTRAINT "emergency_food_requests_matched_surplus_id_fkey" FOREIGN KEY ("matched_surplus_id") REFERENCES "surplus_listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
