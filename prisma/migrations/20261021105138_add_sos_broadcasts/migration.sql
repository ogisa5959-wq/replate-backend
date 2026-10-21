-- CreateEnum
CREATE TYPE "BroadcastStatus" AS ENUM ('ACTIVE', 'RESPONDED', 'EXPIRED', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SupplierResponseStatus" AS ENUM ('CONFIRMED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED');

-- AlterTable
ALTER TABLE "surplus_listings" ADD COLUMN     "is_emergency_response" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "emergency_broadcasts" (
    "id" UUID NOT NULL,
    "emergency_request_id" UUID NOT NULL,
    "recipient_org_name" VARCHAR(255) NOT NULL,
    "recipient_location" VARCHAR(500) NOT NULL,
    "needed_food_type" VARCHAR(100) NOT NULL,
    "food_type_name" VARCHAR(255),
    "requested_portions" INTEGER NOT NULL,
    "target_quantity_kg" DECIMAL(10,2) NOT NULL,
    "urgency_level" "EmergencyUrgencyLevel" NOT NULL,
    "urgency_deadline" VARCHAR(255),
    "urgency_reason" TEXT NOT NULL,
    "contact_person" VARCHAR(255),
    "contact_phone" VARCHAR(50),
    "radius_km" DECIMAL(5,2) NOT NULL DEFAULT 10.0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "status" "BroadcastStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "emergency_broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_broadcast_responses" (
    "id" UUID NOT NULL,
    "broadcast_id" UUID NOT NULL,
    "supplier_org_id" UUID NOT NULL,
    "supplier_org_name" VARCHAR(255) NOT NULL,
    "supplier_user_id" UUID NOT NULL,
    "surplus_listing_id" UUID,
    "journey_id" UUID,
    "status" "SupplierResponseStatus" NOT NULL DEFAULT 'CONFIRMED',
    "responded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_broadcast_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "emergency_broadcasts_emergency_request_id_key" ON "emergency_broadcasts"("emergency_request_id");

-- CreateIndex
CREATE INDEX "emergency_broadcasts_status_expires_at_idx" ON "emergency_broadcasts"("status", "expires_at");

-- CreateIndex
CREATE INDEX "emergency_broadcasts_emergency_request_id_idx" ON "emergency_broadcasts"("emergency_request_id");

-- CreateIndex
CREATE INDEX "supplier_broadcast_responses_supplier_org_id_idx" ON "supplier_broadcast_responses"("supplier_org_id");

-- CreateIndex
CREATE INDEX "supplier_broadcast_responses_broadcast_id_idx" ON "supplier_broadcast_responses"("broadcast_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_broadcast_responses_broadcast_id_supplier_org_id_key" ON "supplier_broadcast_responses"("broadcast_id", "supplier_org_id");

-- AddForeignKey
ALTER TABLE "emergency_broadcasts" ADD CONSTRAINT "emergency_broadcasts_emergency_request_id_fkey" FOREIGN KEY ("emergency_request_id") REFERENCES "emergency_food_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_broadcast_responses" ADD CONSTRAINT "supplier_broadcast_responses_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "emergency_broadcasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_broadcast_responses" ADD CONSTRAINT "supplier_broadcast_responses_supplier_org_id_fkey" FOREIGN KEY ("supplier_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_broadcast_responses" ADD CONSTRAINT "supplier_broadcast_responses_supplier_user_id_fkey" FOREIGN KEY ("supplier_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
