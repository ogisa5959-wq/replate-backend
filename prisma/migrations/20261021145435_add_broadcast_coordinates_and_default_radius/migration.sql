-- AlterTable
ALTER TABLE "emergency_broadcasts" ADD COLUMN     "latitude" DECIMAL(9,6),
ADD COLUMN     "longitude" DECIMAL(9,6),
ALTER COLUMN "radius_km" SET DEFAULT 20.0;
