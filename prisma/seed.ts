import { PrismaClient, UserRole, OrganizationType, FoodCategory, RecipientType } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting REPLATE Purbalingga database seeding...');

  // 1. Bersihkan seluruh data operasional lama (Clean State)
  console.log('🧹 Menghapus seluruh data lama di database (TRUNCATE)...');
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE 
      audit_logs,
      journey_timeline_events,
      rescue_journeys,
      supplier_broadcast_responses,
      emergency_broadcasts,
      emergency_food_requests,
      rescue_score_assessments,
      food_safety_assessments,
      surplus_listings,
      recipient_capacities,
      recipient_profiles,
      refresh_tokens,
      users,
      organizations
    CASCADE;
  `);

  // 2. Seed Master Food Types
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

  // 3. Seed Organizations (1 Admin, 4 Supplier, 4 Mitra di Purbalingga)
  console.log('Seeding 9 Purbalingga organizations...');

  // A. Admin HQ (BPBD & Bappeda Purbalingga)
  const adminOrg = await prisma.organization.create({
    data: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Pusat Koordinasi REPLATE Purbalingga (BPBD & Bappeda)',
      type: OrganizationType.ADMIN_HQ,
      address: 'Jl. Onje No. 1, Purbalingga Kota, Jawa Tengah',
      contactPhone: '0281-891001',
      contactEmail: 'admin@replate.id',
      latitude: -7.388000,
      longitude: 109.364500,
      isVerified: true,
    },
  });

  // B. 4 Supplier Organizations
  // Supplier 1: Purbalingga Kota (Alun-Alun)
  const supplierKotaOrg = await prisma.organization.create({
    data: {
      id: '00000000-0000-0000-0000-000000000002',
      name: 'CV Surya Katering Purbalingga Kota',
      type: OrganizationType.SUPPLIER,
      address: 'Jl. Ahmad Yani No. 15, Purbalingga Wetan, Purbalingga',
      contactPhone: '0281-892111',
      contactEmail: 'supplier@replate.id',
      latitude: -7.385000,
      longitude: 109.360000,
      isVerified: true,
    },
  });

  // Supplier 2: Kalimanah (~3.5 km dari Kota)
  const supplierKalimanahOrg = await prisma.organization.create({
    data: {
      id: '00000000-0000-0000-0000-000000000012',
      name: 'Toko Roti & Bakery Berkah Kalimanah',
      type: OrganizationType.SUPPLIER,
      address: 'Jl. Raya Kalimanah No. 88, Kalimanah, Purbalingga',
      contactPhone: '0281-893222',
      contactEmail: 'supplier-kalimanah@replate.id',
      latitude: -7.400000,
      longitude: 109.335000,
      isVerified: true,
    },
  });

  // Supplier 3: Bobotsari (~9.8 km dari Kota, ~13.1 km dari Karangreja)
  const supplierBobotsariOrg = await prisma.organization.create({
    data: {
      id: '00000000-0000-0000-0000-000000000013',
      name: 'Dapur Resto & Katering Bobotsari',
      type: OrganizationType.SUPPLIER,
      address: 'Jl. Pasar Hewan No. 20, Bobotsari, Purbalingga',
      contactPhone: '0281-894333',
      contactEmail: 'supplier-bobotsari@replate.id',
      latitude: -7.300000,
      longitude: 109.380000,
      isVerified: true,
    },
  });

  // Supplier 4: Karangreja (> 21 km dari Kota, Lereng Gn. Slamet)
  const supplierKarangrejaOrg = await prisma.organization.create({
    data: {
      id: '00000000-0000-0000-0000-000000000014',
      name: 'Resto Agrowisata Lembah Asri Karangreja',
      type: OrganizationType.SUPPLIER,
      address: 'Jl. Raya Karangreja KM 23, Karangreja, Purbalingga',
      contactPhone: '0281-895444',
      contactEmail: 'supplier-karangreja@replate.id',
      latitude: -7.190000,
      longitude: 109.330000,
      isVerified: true,
    },
  });

  // C. 4 Mitra Organizations
  // Mitra 1: Purbalingga Kota (Alun-Alun)
  const mitraKotaOrg = await prisma.organization.create({
    data: {
      id: '00000000-0000-0000-0000-000000000003',
      name: 'Dapur Sosial Alun-Alun Purbalingga',
      type: OrganizationType.RECIPIENT,
      address: 'Jl. Jenderal Soedirman No. 1, Purbalingga Lor, Purbalingga',
      contactPhone: '0281-891234',
      contactEmail: 'mitra@replate.id',
      latitude: -7.387500,
      longitude: 109.363900,
      isVerified: true,
    },
  });

  // Mitra 2: Kalimanah (~3.8 km dari Kota)
  const mitraKalimanahOrg = await prisma.organization.create({
    data: {
      id: '00000000-0000-0000-0000-000000000022',
      name: 'Posko Pangan & Dapur Kalimanah',
      type: OrganizationType.RECIPIENT,
      address: 'Jl. Mayjen Sungkono No. 45, Kalimanah, Purbalingga',
      contactPhone: '0281-892345',
      contactEmail: 'purbalingga-kalimanah@replate.id',
      latitude: -7.395000,
      longitude: 109.330000,
      isVerified: true,
    },
  });

  // Mitra 3: Bobotsari (~9.2 km dari Kota)
  const mitraBobotsariOrg = await prisma.organization.create({
    data: {
      id: '00000000-0000-0000-0000-000000000023',
      name: 'Bank Makanan & Dapur Dhuafa Bobotsari',
      type: OrganizationType.RECIPIENT,
      address: 'Jl. Kolonel Sugiono No. 12, Bobotsari, Purbalingga',
      contactPhone: '0281-893456',
      contactEmail: 'purbalingga-bobotsari@replate.id',
      latitude: -7.305000,
      longitude: 109.375000,
      isVerified: true,
    },
  });

  // Mitra 4: Karangreja (> 21 km dari Kota, Lereng Gn. Slamet)
  const mitraKarangrejaOrg = await prisma.organization.create({
    data: {
      id: '00000000-0000-0000-0000-000000000024',
      name: 'Posko Tanggap Bencana Karangreja (Lereng Gn. Slamet)',
      type: OrganizationType.RECIPIENT,
      address: 'Jl. Raya Golaga KM 2, Karangreja, Purbalingga',
      contactPhone: '0281-894567',
      contactEmail: 'purbalingga-karangreja@replate.id',
      latitude: -7.195000,
      longitude: 109.325000,
      isVerified: true,
    },
  });

  // 4. Seed Users (Password umum: password123)
  console.log('Seeding 9 users (1 Admin, 4 Supplier, 4 Mitra)...');
  const defaultPasswordHash = await argon2.hash('password123');

  // Admin
  await prisma.user.create({
    data: {
      id: '10000000-0000-0000-0000-000000000001',
      organizationId: adminOrg.id,
      email: 'admin@replate.id',
      passwordHash: defaultPasswordHash,
      fullName: 'Siti Admin Purbalingga (BPBD)',
      role: UserRole.ADMIN,
      isActive: true,
    },
  });

  // 4 Suppliers
  await prisma.user.createMany({
    data: [
      {
        id: '10000000-0000-0000-0000-000000000002',
        organizationId: supplierKotaOrg.id,
        email: 'supplier@replate.id',
        passwordHash: defaultPasswordHash,
        fullName: 'Chef Surya (Katering Kota)',
        role: UserRole.SUPPLIER,
        isActive: true,
      },
      {
        id: '10000000-0000-0000-0000-000000000012',
        organizationId: supplierKalimanahOrg.id,
        email: 'supplier-kalimanah@replate.id',
        passwordHash: defaultPasswordHash,
        fullName: 'Budi Bakery (Kalimanah)',
        role: UserRole.SUPPLIER,
        isActive: true,
      },
      {
        id: '10000000-0000-0000-0000-000000000013',
        organizationId: supplierBobotsariOrg.id,
        email: 'supplier-bobotsari@replate.id',
        passwordHash: defaultPasswordHash,
        fullName: 'Pak Resto (Bobotsari)',
        role: UserRole.SUPPLIER,
        isActive: true,
      },
      {
        id: '10000000-0000-0000-0000-000000000014',
        organizationId: supplierKarangrejaOrg.id,
        email: 'supplier-karangreja@replate.id',
        passwordHash: defaultPasswordHash,
        fullName: 'Pengelola Agrowisata (Karangreja)',
        role: UserRole.SUPPLIER,
        isActive: true,
      },
    ],
  });

  // 4 Mitras
  await prisma.user.createMany({
    data: [
      {
        id: '10000000-0000-0000-0000-000000000003',
        organizationId: mitraKotaOrg.id,
        email: 'mitra@replate.id',
        passwordHash: defaultPasswordHash,
        fullName: 'Ahmad Dapur Sosial (Kota)',
        role: UserRole.MITRA,
        isActive: true,
      },
      {
        id: '10000000-0000-0000-0000-000000000022',
        organizationId: mitraKalimanahOrg.id,
        email: 'purbalingga-kalimanah@replate.id',
        passwordHash: defaultPasswordHash,
        fullName: 'Siti Posko Pangan (Kalimanah)',
        role: UserRole.MITRA,
        isActive: true,
      },
      {
        id: '10000000-0000-0000-0000-000000000023',
        organizationId: mitraBobotsariOrg.id,
        email: 'purbalingga-bobotsari@replate.id',
        passwordHash: defaultPasswordHash,
        fullName: 'Hendra Bank Pangan (Bobotsari)',
        role: UserRole.MITRA,
        isActive: true,
      },
      {
        id: '10000000-0000-0000-0000-000000000024',
        organizationId: mitraKarangrejaOrg.id,
        email: 'purbalingga-karangreja@replate.id',
        passwordHash: defaultPasswordHash,
        fullName: 'Relawan Posko Bencana (Karangreja)',
        role: UserRole.MITRA,
        isActive: true,
      },
    ],
  });

  // 5. Seed Recipient Profiles & Daily Capacities untuk 4 Mitra
  console.log('Seeding recipient profiles and daily capacities...');
  const mitrasConfig = [
    {
      id: '20000000-0000-0000-0000-000000000001',
      orgId: mitraKotaOrg.id,
      recipientType: RecipientType.COMMUNITY_KITCHEN,
      maxCapacityKg: 100.0,
      latitude: -7.387500,
      longitude: 109.363900,
    },
    {
      id: '20000000-0000-0000-0000-000000000022',
      orgId: mitraKalimanahOrg.id,
      recipientType: RecipientType.COMMUNITY_KITCHEN,
      maxCapacityKg: 80.0,
      latitude: -7.395000,
      longitude: 109.330000,
    },
    {
      id: '20000000-0000-0000-0000-000000000023',
      orgId: mitraBobotsariOrg.id,
      recipientType: RecipientType.FOOD_BANK,
      maxCapacityKg: 120.0,
      latitude: -7.305000,
      longitude: 109.375000,
    },
    {
      id: '20000000-0000-0000-0000-000000000024',
      orgId: mitraKarangrejaOrg.id,
      recipientType: RecipientType.COMMUNITY_KITCHEN,
      maxCapacityKg: 150.0,
      latitude: -7.195000,
      longitude: 109.325000,
    },
  ];

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  for (const m of mitrasConfig) {
    const profile = await prisma.recipientProfile.create({
      data: {
        id: m.id,
        organizationId: m.orgId,
        recipientType: m.recipientType,
        acceptedFoodCategories: [FoodCategory.COOKED_MEALS, FoodCategory.BAKERY_PASTRY, FoodCategory.FRESH_PRODUCE],
        hasRefrigeration: true,
        hasFreezer: true,
        dailyMaxCapacityKg: m.maxCapacityKg,
        latitude: m.latitude,
        longitude: m.longitude,
      },
    });

    await prisma.recipientCapacity.create({
      data: {
        recipientId: profile.id,
        capacityDate: today,
        maxCapacityKg: m.maxCapacityKg,
        allocatedCapacityKg: 0.0,
        receivedCapacityKg: 0.0,
        availableCapacityKg: m.maxCapacityKg,
      },
    });
  }

  console.log('✅ REPLATE Purbalingga seeding finished successfully:');
  console.log('   - 1 Admin: admin@replate.id (password: password123)');
  console.log('   - 4 Mitra: Purbalingga Kota, Kalimanah, Bobotsari, Karangreja');
  console.log('   - 4 Supplier: Purbalingga Kota, Kalimanah, Bobotsari, Karangreja');
  console.log('   - Seluruh password akun: password123');
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
