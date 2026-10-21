# REPLATE Backend — Architectural Decision Records (ADR) & Technical Decisions

Dokumen ini mencatat keputusan arsitektur resmi (*Architectural Decision Records*), evaluasi trade-off teknologi, audit formula domain, penanganan konkurensi, dan batasan operasional untuk backend **REPLATE**. Seluruh keputusan di bawah ini telah diselaraskan dengan arahan pengguna dan hasil audit source code frontend.

---

## Ringkasan Status Keputusan Arsitektur (ADR Summary)

| ID ADR | Judul Keputusan | Status | Ruang Lingkup |
|---|---|---|---|
| **ADR-001** | Pemilihan ORM: Prisma ORM untuk NestJS & PostgreSQL | `ACCEPTED` | Fondasi Data Layer |
| **ADR-002** | Formula Rescue Score Deterministik & Food Safety Gate sebagai Hard Gate | `ACCEPTED` | Domain Engine |
| **ADR-003** | Strategi Autentikasi JWT + Refresh Token Terotasi & Otorisasi RBAC | `ACCEPTED` | Keamanan & Akun |
| **ADR-004** | Penanganan Concurrency: Pessimistic Row Locking pada Kuota Mitra | `ACCEPTED` | Transaksi & Integritas |
| **ADR-005** | Standar Format Envelope API & Respons Kesalahan Terstruktur | `ACCEPTED` | HTTP / API Design |
| **ADR-006** | Pemisahan Lingkungan & Manajemen Secret Tanpa Kebocoran Repositori | `ACCEPTED` | Infrastruktur & Konfigurasi |
| **ADR-007** | Pembatasan Tepat Tiga Role Pengguna untuk MVP (ADMIN, SUPPLIER, MITRA) | `ACCEPTED` | Otorisasi & Peran |
| **ADR-008** | Penolakan Fisik di Lokasi Mitra Menggunakan Status CANCELLED | `ACCEPTED` | Logistik & Integritas |
| **ADR-009** | Expiry Worker Menggunakan @nestjs/schedule (Interval Default 5 Menit) | `ACCEPTED` | Background Worker |
| **ADR-010** | Pemisahan State Machine: Listing Lifecycle vs Journey Lifecycle | `ACCEPTED` | Siklus Hidup Transaksi |
| **ADR-011** | Model Kapasitas Terproteksi & Akuntansi Kuota Harian | `ACCEPTED` | Kapasitas & Alokasi |
| **ADR-012** | Kebijakan Validasi Waktu Penyiapan & Sumber Waktu Aman (safeUntilTimestamp) | `ACCEPTED` | Validasi & Keamanan Pangan |
| **ADR-013** | Eksekusi Pengujian Integrasi Database Berurutan (--runInBand) | `ACCEPTED` | Pengujian & Mutu |
| **ADR-014** | Alur Alokasi Pangan Darurat (Emergency Requisition) & Hard Gate FSG PASS | `ACCEPTED` | Domain & Keamanan Pangan |
| **ADR-015** | Proteksi Tombstone & Soft Delete pada Penghapusan Data Multi-Device | `ACCEPTED` | Integritas Data & Cloud Sync |

---

## 1. ADR-001: Pemilihan ORM (Object-Relational Mapping)

### Konteks & Kebutuhan
Backend REPLATE dibangun menggunakan **NestJS** dan **PostgreSQL**. Berdasarkan `AGENTS.md` Bagian 4, prioritas utama rekayasa perangkat lunak adalah:
> *"Keterbacaan, kemudahan pemeliharaan, dan pemisahan tanggung jawab. Pokoknya keterbacaan tuh prioritas utama di atas segalanya deh."*

Kebutuhan sistem:
- Skema basis data yang eksplisit, mudah dibaca, dan terdokumentasi rapi.
- Sistem migrasi deklaratif dan terversi (*version-controlled migrations*).
- Keamanan terhadap SQL Injection melalui *parameterized queries*.
- Dukungan transaksi ACID untuk operasi kritis (alokasi kapasitas mitra penerima dan transisi status logistik).
- Kemampuan eksekusi kueri terkunci (*pessimistic locking*) untuk mencegah *race condition* / *double claim*.

### Opsi yang Dipertimbangkan

| Kriteria | Prisma ORM | TypeORM | MikroORM | Kysely (Query Builder) |
|---|---|---|---|---|
| **Keterbacaan Skema** | ⭐⭐⭐⭐⭐ (File `.prisma` deklaratif dan sangat mudah dipahami) | ⭐⭐⭐ (Dekorator TypeScript tersebar di banyak entity class) | ⭐⭐⭐⭐ (Entity class bersih, konfigurasi terpusat) | ⭐⭐⭐ (Migrasi SQL manual / TypeScript interface) |
| **Type Safety** | ⭐⭐⭐⭐⭐ (Auto-generated TypeScript types 100% sinkron) | ⭐⭐⭐ (Kadang type relasi `any` atau tidak otomatis sinkron) | ⭐⭐⭐⭐ (Type safety tinggi) | ⭐⭐⭐⭐⭐ (Type-safe query builder murni) |
| **Ergonomi Migrasi** | ⭐⭐⭐⭐⭐ (`prisma migrate dev` otomatis mendeteksi perubahan skema) | ⭐⭐ (Generator migrasi TypeORM terkenal rentan *false diff* dan bug) | ⭐⭐⭐⭐ (Migrasi CLI bagus) | ⭐⭐⭐ (Perlu menulis migrasi manual SQL/TS) |
| **Integrasi NestJS** | ⭐⭐⭐⭐ (PrismaService singleton sangat sederhana dan clean) | ⭐⭐⭐⭐⭐ (`@nestjs/typeorm` modul resmi NestJS) | ⭐⭐⭐⭐ (`@mikro-orm/nestjs` tersedia) | ⭐⭐⭐ (Perlu wrapper service manual) |
| **Dukungan Concurrency Locking** | ⭐⭐⭐⭐ (Dapat menggunakan `$queryRaw` / interactive transaction) | ⭐⭐⭐⭐⭐ (Dukungan bawaan `.setLock('pessimistic_write')`) | ⭐⭐⭐⭐⭐ (Dukungan bawaan `LockMode.PESSIMISTIC_WRITE`) | ⭐⭐⭐⭐⭐ (Dukungan bawaan `.forUpdate()`) |
| **Learning Curve Tim** | Sangat rendah (format intuitif, dokumentasi unggul) | Menengah (banyak jebakan pada cascade, lazy loading, dan subscriber) | Menengah-Tinggi (konsep identity map & unit of work mirip Hibernate) | Menengah (butuh kemahiran SQL murni) |

### Keputusan
**Status: `ACCEPTED`**
Dipilih **Prisma ORM (v5.x/v6.x)** sebagai data mapper utama.
- **Alasan Pemilihan:** Keterbacaan skema dalam satu berkas `schema.prisma`, migrasi SQL deklaratif yang bersih, dan type safety TypeScript otomatis.
- **Penanganan Concurrency Locking:** Prisma mengeksekusi *pessimistic row locking* di dalam *interactive transaction* menggunakan query terkunci `tx.$queryRaw` (`SELECT ... FOR UPDATE`) pada tabel kapasitas mitra penerima.

---

## 2. ADR-002: Rekonsiliasi Formula Rescue Score & Food Safety Gate

### Konteks Audit
Dalam instruksi audit awal terdapat pertanyaan mengenai formula:
$$\text{Rescue Score} = U \times 0.35 + N \times 0.25 + Q \times 0.20 + F \times 0.20 - P_{\text{safety}}$$

### Temuan Audit & Fakta Repositori
Berdasarkan audit menyeluruh terhadap kode sumber aktual ([`src/engine/rescueScore.js`](file:///home/zeo/Projects/Soedirman%20tech/replate-frontend/src/engine/rescueScore.js), [`src/engine/foodSafetyGate.js`](file:///home/zeo/Projects/Soedirman%20tech/replate-frontend/src/engine/foodSafetyGate.js), dan [`src/data/rules.js`](file:///home/zeo/Projects/Soedirman%20tech/replate-frontend/src/data/rules.js)):
1. **Formula hipotetis di atas TIDAK digunakan di repositori.**
2. **Formula terverifikasi yang sebenarnya diterapkan:**
   $$\text{Raw Score} = (C \times 0.30) + (U \times 0.25) + (Q \times 0.15) + (E \times 0.15) + (D \times 0.15)$$
   Dengan koefisien bobot (`RESCUE_SCORE_WEIGHTS`):
   - $C$ (*Condition Score*, 0–100): Bobot 30% (`condition: 0.30`)
   - $U$ (*Urgency Score*, 0–100): Bobot 25% (`urgency: 0.25`)
   - $Q$ (*Quantity / Volume Viability Score*, 0–100): Bobot 15% (`quantity: 0.15`)
   - $E$ (*Distribution Ease*, 0–100): Bobot 15% (`distributionEase: 0.15`)
   - $D$ (*Destination Compatibility*, 0–100): Bobot 15% (`destinationCompatibility: 0.15`)
   Total bobot: $0.30 + 0.25 + 0.15 + 0.15 + 0.15 = 1.00$ (100%).
3. **Threshold Prioritas:**
   - $\ge 80$: `HIGH PRIORITY`
   - $60 - 79$: `MEDIUM PRIORITY`
   - $0 - 59$: `LOW PRIORITY`
4. **Food Safety Gate sebagai Gerbang Mutlak (*Hard Gate*):**
   - Keamanan pangan **BUKAN penalti subtraktif ($P_{\text{safety}}$)** di dalam skor.
   - Evaluasi keamanan pangan dilakukan secara independen lebih awal dengan urutan ketat: $\text{REJECT} > \text{REVIEW} > \text{PASS}$.
   - Jika status FSG adalah `REJECT` atau `REVIEW`:
     - Rute konsumsi manusia (`REDISTRIBUTE` dan `PROCESS`) **DIBLOKIR SECARA MUTLAK**.
     - Rekomendasi mitra konsumsi pangan manusia dikunci/dilarang untuk dipilih.
     - Jika pengguna mengonfirmasi pengalihan ke daur ulang kompos industri (`ORGANIC`), Rescue Score diatur ke `0` (*Inedible*).

### Bahaya Memperlakukan Keamanan Pangan sebagai Penalti Minus ($P_{\text{safety}}$)
Jika keamanan pangan diperlakukan sebagai penalti minus (misal $-30$), maka makanan berlendir/basi dalam volume sangat besar ($Q=100$) dan sangat mendesak ($U=100$) masih dapat menghasilkan skor total positif $50$ (*Medium Priority*) dan teralokasi ke panti asuhan/dapur umum. Hal ini merupakan pelanggaran fatal terhadap etika perlindungan kesehatan masyarakat.

### Keputusan
**Status: `ACCEPTED`**
Backend mempertahankan **Arsitektur Dua Tahap (*Two-Stage Evaluation Architecture*)**:
1. **Tahap 1: Food Safety Gate** adalah *hard gate* tanpa kompromi. Status `REJECT` dan `REVIEW` memblokir mutlak alokasi konsumsi manusia.
2. **Tahap 2: Rescue Score Engine** hanya dieksekusi jika Tahap 1 menghasilkan `PASS`. Formula bobot 5 faktor aktual repositori adalah *single source of truth*.

---

## 3. ADR-003: Strategi Autentikasi dan Otorisasi (RBAC & Ownership)

### Konteks & Kebutuhan
Frontend menyimpan sesi pengguna di `localStorage` dengan tiga akun demo teks polos: `admin`/`admin123`, `supplier`/`supplier123`, `mitra`/`mitra123`.

### Keputusan
**Status: `ACCEPTED`**
1. **Password Hashing:** Menggunakan **Argon2id** (atau bcrypt dengan cost 12) dengan salt unik per pengguna.
2. **Dual-Token System:**
   - **Access Token:** JWT berumur pendek (**15 menit**), berisi payload `{ sub: userId, role: Role, organizationId: string }`.
   - **Refresh Token:** Token acak berentropi tinggi berumur panjang (**7 hari**), disimpan dalam database sebagai **hash SHA-256** untuk mendukung mekanisme pembatalan (*revocation*).
   - Pengiriman: Access token via header `Authorization: Bearer <token>`, Refresh token via cookie `httpOnly`, `Secure`, `SameSite=Lax`.
3. **Otorisasi:** Menggunakan `@Roles()` decorator dan `RolesGuard` di NestJS, diperkuat oleh `OwnershipGuard` untuk memastikan pengguna hanya dapat mengubah resource milik organisasinya sendiri.

---

## 4. ADR-004: Penanganan Concurrency dan Pencegahan Double Allocation

### Konteks Masalah
Dua supplier secara bersamaan dapat memilih mitra penerima yang sama yang kapasitas tersisanya hampir habis, mengakibatkan kelebihan muatan (*overbooking*).

### Keputusan
**Status: `ACCEPTED`**
1. **Pessimistic Row Locking:** Operasi pencadangan kuota kapasitas mitra dieksekusi di dalam transaksi interaktif Prisma menggunakan `SELECT ... FOR UPDATE` pada tabel `recipient_capacities`.
2. **Database Check Constraint:** Tabel `recipient_capacities` memiliki constraint `CHECK (available_capacity_kg >= 0)` untuk perlindungan tingkat basis data.
3. **Optimistic Locking:** Tabel `rescue_journeys` memiliki kolom `concurrency_version INT DEFAULT 1` untuk mencegah dua pengguna mengubah status pengiriman yang sama secara bersamaan.

---

## 5. ADR-005: Format Envelope Respons API & Penanganan Kesalahan

### Keputusan
**Status: `ACCEPTED`**
1. **Format Respons Sukses:** Menggunakan envelope seragam:
   ```json
   {
     "success": true,
     "statusCode": 200,
     "data": { ... },
     "meta": { "timestamp": "...", "pagination": { ... } }
   }
   ```
2. **Format Respons Error:** Menggunakan **custom envelope terstruktur yang terinspirasi oleh RFC 7807 Problem Details** (bukan implementasi RFC 7807 murni tanpa envelope). Format ini menyajikan `statusCode`, `error` (nama error/title), `message` (deskripsi ramah pengguna), `details` (rincian validasi per-field), `timestamp`, dan `path`:
   ```json
   {
     "success": false,
     "statusCode": 400,
     "error": "BAD_REQUEST",
     "message": "Validasi input gagal pada parameter Food Safety Gate.",
     "details": [
       { "field": "preparedAt", "code": "TIMESTAMP_IN_FUTURE", "message": "Waktu penyiapan tidak boleh berada di masa depan." }
     ],
     "timestamp": "2026-10-15T14:48:00.000Z",
     "path": "/api/v1/surplus-listings"
   }
   ```

---

## 6. ADR-006: Pemisahan Lingkungan & Manajemen Secret

### Keputusan
**Status: `ACCEPTED`**
1. Tidak ada secret di repositori. Template variabel lingkungan disediakan di `.env.example`.
2. Konfigurasi terpusat via `@nestjs/config` dengan validasi skema berbasis Zod (*fail-fast startup*).
3. Lingkungan pengembangan lokal di Fedora VM: PostgreSQL berjalan di Docker Compose dengan port mapping `5432:5432`, backend berjalan di host host Fedora VM terhubung ke `localhost:5432`.

---

## 7. ADR-007: Batasan Tiga Role Inti MVP (ADMIN, SUPPLIER, MITRA)

### Konteks Keputusan
Pada evaluasi awal dipertimbangkan apakah platform membutuhkan peran keempat (`COURIER`) dengan aplikasi dan dashboard kurir terpisah.

### Keputusan
**Status: `ACCEPTED` (Final untuk MVP)**
1. **Tepat Tiga Role:** Sistem MVP mempertahankan tepat 3 peran pengguna:
   - `ADMIN`: Monitoring operasional seluruh kota, audit keselamatan pangan, dan intervensi darurat.
   - `SUPPLIER`: Melaporkan surplus, memantau pengantaran keluar (*outbound*), menandai serah terima ke kurir (`RESCUE_INITIATED`).
   - `MITRA`: Memantau pasokan masuk (*inbound*), mengonfirmasi serah terima fisik (`RECEIVED`), atau menolak kiriman di tempat (`CANCELLED`).
2. **Tidak Ada Role Kurir di MVP:** Tidak dibuat dashboard kurir, akun login kurir, entitas kurir, atau autentikasi kurir pada tahap MVP.
3. **Ekspansi Pasca-MVP:** Penambahan entitas `couriers` dan role `COURIER` dengan token tugas lapangan (*dispatch token*) dicatat sebagai kandidat fitur fase rilis berikutnya.

---

## 8. ADR-008: Protokol Penolakan Fisik di Lokasi Mitra (Doorstep Rejection)

### Konteks Keputusan
Makanan yang lolos pemeriksaan gerbang digital awal dapat mengalami kerusakan fisik atau penurunan suhu selama perjalanan kurir menuju mitra penerima.

### Keputusan
**Status: `ACCEPTED` (Final untuk MVP)**
1. **Status Akhir: `CANCELLED`:** Perjalanan yang ditolak secara fisik di lokasi penerima diberi status `CANCELLED`.
2. **Alasan Wajib Diisi:** Mitra wajib memasukkan alasan penolakan (`cancellationReason`, misal *"Suhu penyimpanan di luar toleransi"* atau *"Wadah pecah saat pengiriman"*). Permintaan tanpa alasan ditolak dengan `400 Bad Request`.
3. **Audit Trail Lengkap:** Alasan penolakan, aktor penolak (Mitra), timestamp, status sebelumnya (`RESCUE_INITIATED`), dan status sesudahnya (`CANCELLED`) dicatat permanen dalam transaksi database pada `rescue_journeys`, `journey_timeline_events`, dan `audit_logs`.
4. **Tidak Ada Reroute Otomatis:** Sistem **TIDAK menjalankan reroute otomatis** ke `ORGANIC`, fasilitas kompos, atau tujuan lain. Makanan yang ditolak tidak boleh otomatis diasumsikan aman untuk rute lain.
5. **Akuntansi Kapasitas Bersih:** Kapasitas mitra yang sebelumnya dicadangkan (`allocated_capacity_kg`) dilepaskan kembali secara atomik ke `available_capacity_kg` pada hari tersebut. Listing surplus yang bersangkutan ditandai `CANCELLED`. Tidak ada kuota yang menggantung atau terhitung ganda.
6. **Tidak Mengubah ke `RECEIVED`:** Penolakan fisik dilarang keras dicatat sebagai `RECEIVED`.

---

## 9. ADR-009: Background Expiry Worker Menggunakan @nestjs/schedule

### Konteks Keputusan
Makanan siap santap memiliki sisa waktu aman terbatas. Jika makanan tidak kunjung diambil atau dicocokkan, statusnya harus kedaluwarsa secara otomatis.

### Keputusan
**Status: `ACCEPTED` (Final untuk MVP)**
1. **Framework Worker:** Menggunakan modul cron internal NestJS (`@nestjs/schedule`). Tidak menambahkan dependensi eksternal seperti Redis atau BullMQ dalam MVP.
2. **Interval Pemeriksaan Default:** Ditetapkan konsisten **setiap 5 menit** (`cron: '*/5 * * * *'`).
3. **Sumber Waktu Aman Baku:** Menggunakan kolom timestamp UTC eksplisit `safe_until_timestamp` pada tabel `surplus_listings`, bukan sekadar parsing string label seperti `under_1h`.
4. **Idempotensi & Keamanan Konkurensi:**
   - Eksekusi worker bersifat idempoten: baris diperbarui menggunakan klausa kondisional `WHERE current_lifecycle_status IN ('REPORTED', 'ASSESSED', 'MATCHED') AND safe_until_timestamp <= NOW()`.
   - Transaksi terminal (`RECEIVED`, `CANCELLED`, `EXPIRED`) tidak akan diubah kembali.
5. **Dampak Status & Kapasitas:**
   - Listing `REPORTED` atau `ASSESSED` yang kedaluwarsa langsung beralih ke `EXPIRED`.
   - Listing `MATCHED` (sudah dipasangkan ke mitra tetapi kurir belum berangkat): jika waktu aman terlampaui sebelum penjemputan, perjalanan dibatalkan (`CANCELLED` dengan alasan *"Kedaluwarsa sebelum penjemputan logistik"*), reservasi kuota mitra dilepas kembali ke `available_capacity_kg`, dan listing diubah menjadi `EXPIRED`.
   - Listing/Journey `RESCUE_INITIATED` (kurir sedang di jalan membawa makanan fisik): **tidak dibatalkan secara sepihak oleh worker** untuk mencegah konflik dengan barang fisik yang sedang bergerak, melainkan diberi penanda keterlambatan (*overdue alert*) untuk ditindaklanjuti oleh Mitra saat tiba atau Admin.

---

## 10. ADR-010: Pemisahan State Machine (Listing Lifecycle vs Journey Lifecycle)

### Konteks
Terdapat perbedaan antara siklus hidup pelaporan surplus (*Surplus Listing*) dan siklus hidup perjalanan fisik logistik (*Rescue Journey*).

### Keputusan
**Status: `ACCEPTED`**
1. **Listing Lifecycle (`surplus_listings.current_lifecycle_status`):**
   - Nilai sah: `REPORTED`, `ASSESSED`, `MATCHED`, `RESCUE_INITIATED`, `RECEIVED`, `CANCELLED`, `EXPIRED`.
   - `ROUTE_SELECTED` diperlakukan sebagai **event tahapan penilaian**, bukan status diskrit persisten terpisah, agar selaras dengan frontend di mana pemilihan rute langsung disusul oleh pemilihan destinasi (`MATCHED`).
2. **Journey Lifecycle (`rescue_journeys.current_status`):**
   - Dibuat saat alokasi terjadi (`POST .../assign-destination`).
   - Nilai sah: `MATCHED`, `RESCUE_INITIATED`, `RECEIVED`, `CANCELLED`.
3. **Buku Besar Timeline (`journey_timeline_events`):**
   - Mencatat seluruh jejak perubahan status secara urut waktu (*append-only*).

---

## 11. ADR-011: Model Kapasitas Terproteksi & Akuntansi Kuota Harian

### Keputusan
**Status: `ACCEPTED`**
Tabel `recipient_capacities` mengelola kuota harian per mitra dengan definisi semantik yang tegas:
- `max_capacity_kg`: Batas daya tampung fisik harian (misal: 50 kg).
- `allocated_capacity_kg`: Total volume yang sedang dicadangkan (dalam status `MATCHED` atau `RESCUE_INITIATED`).
- `received_capacity_kg`: Total volume fisik yang telah resmi berstatus `RECEIVED` pada hari tersebut.
- `available_capacity_kg`: Kuota sisa yang dapat dialokasikan:
  $$\text{available\_capacity\_kg} = \text{max\_capacity\_kg} - (\text{allocated\_capacity\_kg} + \text{received\_capacity\_kg})$$
- **Aturan Transaksi:**
  - *Saat Assignment:* `allocated += qty`, `available -= qty`.
  - *Saat Diterima (RECEIVED):* `allocated -= qty_reserved`, `received += actual_received_kg`, `available` disesuaikan terhadap selisih aktual.
  - *Saat Dibatalkan / Ditolak Fisik:* `allocated -= qty_reserved`, `available += qty_reserved`.
  - Database check constraints: `CHECK (available_capacity_kg >= 0)`, `CHECK (allocated_capacity_kg >= 0)`, `CHECK (received_capacity_kg >= 0)`.

---

## 12. ADR-012: Kebijakan Validasi Waktu Penyiapan & safeUntilTimestamp

### Keputusan
**Status: `ACCEPTED`**
1. **Validasi Waktu Penyiapan (`preparedAt`):**
   - Waktu penyiapan makanan tidak boleh berada di masa depan.
   - Diberikan toleransi *clock skew* maksimal **5 menit** untuk mengantisipasi perbedaan jam peramban klien dan server.
   - Input yang melampaui toleransi 5 menit di masa depan ditolak dengan `400 Bad Request` pada validasi DTO. Jika lolos ke Food Safety Gate, memicu status `REVIEW` (*illogical preparation timestamp*).
2. **Sumber Waktu Aman (`safeUntilTimestamp`):**
   - Disimpan sebagai kolom `TIMESTAMPTZ` di tabel `surplus_listings`.
   - Dihitung di backend saat listing dibuat atau parameter diperbarui:
     $$\text{safeUntilTimestamp} = \text{preparedAt} + (\text{defaultPerishabilityHours} \times 3600 \text{ detik})$$
   - Disimpan dalam zona waktu UTC. Presentasi lokal disesuaikan di sisi frontend (WIB / UTC+7).
   - Hanya dapat diubah oleh Supplier pemilik listing atau Admin melalui endpoint pembaruan parameter keselamatan.

---

## 14. ADR-014: Alur Alokasi Pangan Darurat (Emergency Requisition) & Hard Gate FSG PASS

### Konteks
Fitur baru frontend `EmergencyDistribution.jsx` memperkenalkan model *pull-based* di mana mitra penerima membuat permohonan bantuan darurat (`EmergencyFoodRequest`), lalu mencocokkan dan mengalokasikan surplus donor yang tersedia. Kedaruratan logistik sering kali memicu godaan operasional untuk melonggarkan batas keamanan pangan demi mempercepat bantuan pangan ke korban bencana.

### Keputusan
**Status: `ACCEPTED`**
1. **Keamanan Pangan Mengesampingkan Kedaruratan Operasional:**
   - Dalam kondisi bencana/darurat apa pun, donasi surplus yang berstatus `REVIEW` atau `REJECT` **DILARANG KERAS** dialokasikan ke permohonan bantuan darurat konsumsi manusia.
   - Endpoint `/emergency-requests/:id/matching-surplus` secara mutlak hanya menyaring surplus listing dengan `safetyStatus === 'PASS'`.
   - Endpoint `/emergency-requests/:id/allocate` memvalidasi ulang status FSG di dalam transaksi database sebelum commit; jika bukan `PASS`, transaksi langsung dibatalkan (`ROLLBACK`) dengan `422 Unprocessable Entity`.
2. **Transaksi ACID Dwiarah:**
   - Alokasi darurat mengikat `SurplusListing`, `EmergencyFoodRequest`, dan `RecipientCapacity` secara atomik di dalam `$transaction`.
   - Kuota mitra pemohon dicadangkan otomatis untuk mencegah *overcapacity*.

---

## 15. ADR-015: Proteksi Tombstone & Soft Delete pada Penghapusan Data Multi-Device

### Konteks
Frontend REPLATE menggunakan arsitektur *local-first* dengan sinkronisasi hybrid ke Supabase / NestJS backend. Pada commit `bc7abb5`, frontend mengimplementasikan indeks *Tombstone* untuk mencatat ID rekaman yang sengaja dihapus oleh pengguna. Tanpa penandaan terhapus yang konsisten di backend, proses sinkronisasi background antar-peramban dapat menganggap rekaman yang masih ada di server sebagai data baru dan menghidupkannya kembali di peramban lokal (*zombie record resurrection*).

### Keputusan
**Status: `ACCEPTED`**
1. Backend mengimplementasikan pola *soft delete* terstandarisasi dengan kolom `is_deleted: Boolean @default(false)` dan `deleted_at: DateTime?` pada entitas `surplus_listings` dan `emergency_food_requests`.
2. Endpoint `DELETE /api/v1/surplus-listings/:id` dan `DELETE /api/v1/emergency-requests/:id` menandai `is_deleted = true` dan mencatat `AuditAction.DELETE`.
3. Kueri koleksi `findAll` dan sinkronisasi secara default menambahkan klausa `WHERE is_deleted = false`.
4. Endpoint audit tetap dapat menginspeksi rekaman terhapus untuk kebutuhan kepatuhan hukum dan keamanan pangan publik.

---

## 16. ADR-016: SOS Emergency Broadcast & Atestasi Darurat Tanpa Capacity Lock

### Konteks
Alur normal REPLATE bersifat *push-only* dari donor ke mitra, di mana surplus yang lolos verifikasi segera dialokasikan sehingga pool surplus tidak teralokasi (*unallocated pool*) sering kali kosong saat mitra posko mengajukan permohonan darurat. Untuk itu diperkenalkan sistem *pull-based* SOS Broadcast berbatas waktu (*expiry window* otomatis) yang menyiarkan kebutuhan posko ke penyedia surplus terdekat. Penyedia surplus yang memiliki stok siap santap dapat langsung mengonfirmasi kesediaan bantuan dalam satu klik tanpa harus mengisi formulir pelaporan surplus panjang terlebih dahulu.

### Keputusan
**Status: `ACCEPTED` (Fase 13 - TASK-013)**
1. **Otomatisasi Transaksi Satu-Klik:**
   - Saat supplier mengonfirmasi bantuan melalui endpoint `POST /api/v1/emergency-broadcasts/:broadcastId/respond`, backend secara atomik di dalam `$transaction` PostgreSQL mengeksekusi:
     - Kunci baris broadcast via `FOR UPDATE` untuk mencegah race condition.
     - Pembentukan entitas `SurplusListing` dengan penanda khusus `isEmergencyResponse = true` dan status awal `MATCHED`.
     - Penerbitan `FoodSafetyAssessment` berstatus `PASS` berbasis atestasi donor darurat (donor secara sadar mengonfirmasi bahwa makanan disiapkan secara higienis, bersih, dan aman dikonsumsi).
     - Pembentukan `RescueJourney` berstatus `MATCHED` dan `JourneyTimelineEvent`.
     - Pembaruan status siaran `EmergencyBroadcast` ke `RESPONDED` dan permohonan `EmergencyFoodRequest` ke `ALLOCATED`.
     - Pencatatan jejak audit komprehensif pada `audit_logs`.
2. **Pengecualian Capacity Lock untuk Respons Darurat:**
   - Respons bantuan darurat **tidak melakukan pessimistic lock kuota kapasitas** (`SELECT ... FOR UPDATE` pada `recipient_capacities`).
   - *Rasional:* Permohonan darurat merupakan intervensi krisis posko bencana/pengungsi di mana bantuan pangan harus dapat disalurkan dengan hambatan minimum. Penolakan donasi akibat kuota harian sistematis terhitung penuh akan menggagalkan penyelamatan jiwa. Pelacakan logistik fisik tetap berjalan normal melalui entitas `RescueJourney`, dan konfirmasi penerimaan fisik tetap dilakukan oleh mitra penerima via endpoint `confirm-receipt`.
3. **Pencegahan Respons Duplikat & Batas Waktu Ketat:**
   - Penerapan constraint unik `@@unique([broadcastId, supplierOrgId])` untuk mencegah donor yang sama mengonfirmasi ganda.
   - Siaran yang telah kedaluwarsa (`expiresAt <= NOW()`) secara deterministik ditolak dengan `422 Unprocessable Entity` dan otomatis beralih ke status `EXPIRED` baik via pemanggilan endpoint aktif maupun background worker berkala.

---

## 17. ADR-017: Manajemen Profil, Koordinat Geospasial Organisasi & Rumus Haversine

### Konteks
Fitur siaran darurat SOS (`EmergencyBroadcast`) dan alur pencocokan logistik REPLATE membutuhkan penentuan radius jarak fisik (misal $\le 20\text{ km}$) antara posko mitra penerima dan donor makanan surplus. Ketergantungan pada API geocoding pihak ketiga berbayar (misal Google Maps API) menimbulkan risiko biaya, latensi jaringan eksternal, dan potensi *vendor lock-in*. Selain itu, model `Organization` sebelumnya belum menyimpan koordinat geospasial (`latitude` dan `longitude`), sehingga koordinat hanya dimiliki secara sepihak oleh model `RecipientProfile`.

### Keputusan
**Status: `ACCEPTED` (Fase 14 - TASK-014)**
1. **Penambahan Koordinat Geospasial pada Organisasi:**
   - Menambahkan field `latitude: Decimal? @db.Decimal(9, 6)` dan `longitude: Decimal? @db.Decimal(9, 6)` pada model `Organization`.
   - Menambahkan field narahubung organisasi `contactEmail: String? @db.VarChar(255)`.
   - Menggunakan presisi desimal 6 angka di belakang koma (akurasi geodetik $\approx 0.11\text{ meter}$).
2. **Kalkulasi Jarak Matematis via Haversine Formula:**
   - Jarak antara koordinat donor dan posko dihitung secara terisolasi dan deterministik menggunakan rumus trigonometri bola bumi **Haversine**:
     $$d = 2R \arcsin\left(\sqrt{\sin^2\left(\frac{\Delta\text{lat}}{2}\right) + \cos(\text{lat}_1)\cos(\text{lat}_2)\sin^2\left(\frac{\Delta\text{lon}}{2}\right)}\right)$$
     dengan $R = 6371\text{ km}$.
   - Logika berjalan 100% di server backend (`haversine.util.ts`) tanpa ketergantungan API pihak ketiga.
3. **Imutabilitas Email & Peran (Role):**
   - Email diperlakukan sebagai pengenal unik autentikasi (*read-only*) dan tidak dapat diubah melalui endpoint profil untuk mencegah *account takeover*.
   - Peran akun (`ADMIN`, `SUPPLIER`, `MITRA`) bersifat tetap sesuai pendaftaran mandiri; form profil berfokus pada spesifikasi operasional fasilitas (kapasitas harian, fasilitas rantai dingin kulkas/freezer, dan kategori pangan yang diterima).
4. **Pencegahan Sesi Basi saat Ubah Password:**
   - Endpoint `PUT /api/v1/profile/password` memverifikasi kata sandi lama via Argon2id, mengenkripsi kata sandi baru, dan secara atomik mencabut (*revoke*) seluruh refresh token aktif untuk memutus sesi di perangkat lain.
