-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "contact_email" VARCHAR(255),
ADD COLUMN     "latitude" DECIMAL(9,6),
ADD COLUMN     "longitude" DECIMAL(9,6);
