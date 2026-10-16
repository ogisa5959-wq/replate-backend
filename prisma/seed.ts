import { PrismaClient, UserRole, OrganizationType, FoodCategory } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting REPLATE database seeding...');

  // 1. Seed Food Types (Master Data)
  console.log('Seeding master food types...');
  const foodTypes = [
    {
      code: 'COOKED_BUFFET',
      nameId: 'Nasi Kotak / Makanan Matang Buffet',
      nameEn: 'Buffet / Cooked Meal Boxes',
      defaultCategory: FoodCategory.COOKED_MEALS,
      maxSafeHours: 4.0,
      recommendedTempMinC: 60.0,
      recommendedTempMaxC: 85.0,
      isPerishable: true,
    },
    {
      code: 'BAKERY_BREAD',
      nameId: 'Roti & Pastry Kemasan',
      nameEn: 'Bread & Packaged Pastries',
      defaultCategory: FoodCategory.BAKERY_PASTRY,
      maxSafeHours: 24.0,
      recommendedTempMinC: 18.0,
      recommendedTempMaxC: 25.0,
      isPerishable: true,
    },
    {
      code: 'DAIRY_PASTEURIZED',
      nameId: 'Produk Susu & Olahan Telur Dingin',
      nameEn: 'Chilled Dairy & Pasteurized Products',
      defaultCategory: FoodCategory.DAIRY_EGGS,
      maxSafeHours: 12.0,
      recommendedTempMinC: 1.0,
      recommendedTempMaxC: 4.0,
      isPerishable: true,
    },
    {
      code: 'FRESH_VEG_FRUIT',
      nameId: 'Buah & Sayuran Segar',
      nameEn: 'Fresh Fruits & Vegetables',
      defaultCategory: FoodCategory.FRESH_PRODUCE,
      maxSafeHours: 48.0,
      recommendedTempMinC: 8.0,
      recommendedTempMaxC: 15.0,
      isPerishable: true,
    },
    {
      code: 'PACKAGED_DRY_GOODS',
      nameId: 'Bahan Pokok & Makanan Kering Tertutup',
      nameEn: 'Dry Goods & Sealed Staples',
      defaultCategory: FoodCategory.PACKAGED_DRY,
      maxSafeHours: 168.0,
      recommendedTempMinC: 15.0,
      recommendedTempMaxC: 30.0,
      isPerishable: false,
    },
  ];

  for (const ft of foodTypes) {
    await prisma.foodType.upsert({
      where: { code: ft.code },
      update: ft,
      create: ft,
    });
  }

  // 2. Seed Organizations
  console.log('Seeding demo organizations...');
  const adminOrg = await prisma.organization.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Pusat Koordinasi REPLATE Jakarta',
      type: OrganizationType.ADMIN_HQ,
      address: 'Jl. Medan Merdeka Selatan No. 8, Jakarta Pusat',
      contactPhone: '021-3456789',
      isVerified: true,
    },
  });

  const supplierOrg = await prisma.organization.upsert({
    where: { id: '00000000-0000-0000-0000-000000000002' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000002',
      name: 'Grand Sahid Catering & Hotel',
      type: OrganizationType.SUPPLIER,
      address: 'Jl. Jend. Sudirman Kav. 86, Jakarta Pusat',
      contactPhone: '021-5704444',
      isVerified: true,
    },
  });

  const mitraOrg = await prisma.organization.upsert({
    where: { id: '00000000-0000-0000-0000-000000000003' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000003',
      name: 'Dapur Sosial Barokah Matraman',
      type: OrganizationType.RECIPIENT,
      address: 'Jl. Matraman Raya No. 42, Jakarta Timur',
      contactPhone: '0812-3456-7890',
      isVerified: true,
    },
  });

  // 3. Seed Users with Argon2 Hash
  console.log('Seeding demo users...');
  const adminPasswordHash = await argon2.hash('admin123');
  const supplierPasswordHash = await argon2.hash('supplier123');
  const mitraPasswordHash = await argon2.hash('mitra123');

  await prisma.user.upsert({
    where: { email: 'admin@replate.id' },
    update: { passwordHash: adminPasswordHash },
    create: {
      id: '10000000-0000-0000-0000-000000000001',
      organizationId: adminOrg.id,
      email: 'admin@replate.id',
      passwordHash: adminPasswordHash,
      fullName: 'Siti Administrator',
      role: UserRole.ADMIN,
      isActive: true,
    },
  });

  await prisma.user.upsert({
    where: { email: 'supplier@replate.id' },
    update: { passwordHash: supplierPasswordHash },
    create: {
      id: '10000000-0000-0000-0000-000000000002',
      organizationId: supplierOrg.id,
      email: 'supplier@replate.id',
      passwordHash: supplierPasswordHash,
      fullName: 'Budi Chef Executive',
      role: UserRole.SUPPLIER,
      isActive: true,
    },
  });

  await prisma.user.upsert({
    where: { email: 'mitra@replate.id' },
    update: { passwordHash: mitraPasswordHash },
    create: {
      id: '10000000-0000-0000-0000-000000000003',
      organizationId: mitraOrg.id,
      email: 'mitra@replate.id',
      passwordHash: mitraPasswordHash,
      fullName: 'Ahmad Pengelola Dapur',
      role: UserRole.MITRA,
      isActive: true,
    },
  });

  // 4. Seed Recipient Profile & Daily Capacity for Mitra
  console.log('Seeding recipient profile and capacity...');
  const recipientProfile = await prisma.recipientProfile.upsert({
    where: { organizationId: mitraOrg.id },
    update: {},
    create: {
      id: '20000000-0000-0000-0000-000000000001',
      organizationId: mitraOrg.id,
      recipientType: 'COMMUNITY_KITCHEN',
      acceptedFoodCategories: [FoodCategory.COOKED_MEALS, FoodCategory.BAKERY_PASTRY, FoodCategory.FRESH_PRODUCE],
      hasRefrigeration: true,
      hasFreezer: true,
      dailyMaxCapacityKg: 100.0,
      latitude: -6.208800,
      longitude: 106.845600,
    },
  });

  // Set today's date at midnight UTC
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  await prisma.recipientCapacity.upsert({
    where: {
      recipientId_capacityDate: {
        recipientId: recipientProfile.id,
        capacityDate: today,
      },
    },
    update: {},
    create: {
      recipientId: recipientProfile.id,
      capacityDate: today,
      maxCapacityKg: 100.0,
      allocatedCapacityKg: 0.0,
      receivedCapacityKg: 0.0,
      availableCapacityKg: 100.0,
    },
  });

  console.log('✅ REPLATE database seeding finished successfully.');
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
