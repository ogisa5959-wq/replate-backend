# REPLATE Backend — REST API v1 Specification & Contract

Dokumen ini mendefinisikan kontrak antarmuka pemrograman aplikasi (API *contract*) resmi untuk **REPLATE REST API v1**, mencakup konvensi HTTP, format *envelope*, aturan validasi, otorisasi berbasis 3 peran MVP (`ADMIN`, `SUPPLIER`, `MITRA`), mesin status (*state machine*), serta contoh *payload* permintaan dan respons untuk seluruh alur bisnis yang diverifikasi dari frontend.

---

## 1. Konvensi Dasar API

### 1.1. Base URL & Versioning
- **Base URL:** `/api/v1`
- **Versioning Strategy:** URI path versioning (`/api/v1`). Setiap perubahan yang melanggar kompatibilitas mundur (*breaking change*) di masa depan akan menggunakan versi baru (`/api/v2`).
- **Protokol:** HTTPS murni (pada lingkungan produksi).

### 1.2. Format Respons Sukses Seragam (Success Envelope)
Semua endpoint yang berhasil mengembalikan data dibungkus dalam format konsisten:

```json
{
  "success": true,
  "statusCode": 200,
  "data": { ... },
  "meta": {
    "timestamp": "2026-10-15T14:48:00.000Z",
    "pagination": {
      "page": 1,
      "limit": 20,
      "totalItems": 42,
      "totalPages": 3
    }
  }
}
```

### 1.3. Format Respons Kesalahan Terstruktur (Error Envelope)
Format respons kesalahan menggunakan **custom envelope terstruktur yang terinspirasi oleh prinsip RFC 7807 Problem Details** (menyajikan kode status HTTP, nama klasifikasi kesalahan `error`, deskripsi ramah pengguna `message`, rincian validasi per-field `details`, timestamp UTC, dan path resource), namun tetap dibungkus dalam envelope aplikasi REPLATE (`success: false`):

```json
{
  "success": false,
  "statusCode": 400,
  "error": "BAD_REQUEST",
  "message": "Validasi input gagal pada parameter Food Safety Gate.",
  "details": [
    {
      "field": "preparedAt",
      "code": "TIMESTAMP_IN_FUTURE",
      "message": "Waktu penyiapan tidak boleh berada di masa depan (melebihi toleransi 5 menit)."
    }
  ],
  "timestamp": "2026-10-15T14:48:00.000Z",
  "path": "/api/v1/surplus-listings"
}
```

### 1.4. Penanganan Waktu & safeUntilTimestamp
1. **Standar Waktu:** Seluruh pertukaran data waktu menggunakan string format **ISO 8601 UTC** (`YYYY-MM-DDTHH:mm:ss.sssZ`). Presentasi lokal ke zona waktu Indonesia Barat (WIB / UTC+7) ditangani di sisi klien.
2. **Validasi Waktu Penyiapan (`preparedAt`):**
   - Waktu penyiapan tidak boleh berada di masa depan.
   - Diberikan toleransi *clock skew* maksimal **5 menit**.
   - Input yang melampaui toleransi 5 menit di masa depan ditolak dengan HTTP `400 Bad Request` oleh DTO.
3. **Sumber Waktu Aman Baku (`safeUntilTimestamp`):**
   - Dihitung secara deterministik di backend saat surplus didaftarkan atau diperbarui:
     $$\text{safeUntilTimestamp} = \text{preparedAt} + (\text{defaultPerishabilityHours} \times 3600 \text{ detik})$$
   - Menjadi acuan tunggal bagi Expiry Worker untuk mendeteksi makanan yang telah melampaui batas aman konsumsi.

---

## 2. State Machine & Definisi Siklus Hidup Transaksi

Sistem memisahkan secara tegas siklus hidup pelaporan surplus (*Listing Lifecycle*) dan siklus hidup perjalanan fisik logistik (*Journey Lifecycle*).

### 2.1. Listing Lifecycle (`surplus_listings.current_lifecycle_status`)

```text
[Draf Masuk] ──> REPORTED ──(Evaluasi Otomatis)──> ASSESSED ──(Pilih Mitra)──> MATCHED ──(Jemput Kurir)──> RESCUE_INITIATED ──(Tiba & Cek Fisik)──> RECEIVED (Terminal)
                    │                                  │                           │                                │
                    ├──(Expiry Worker)                 └──(Batal / Expiry Worker) └──(Batal / Expiry Worker)        └──(Ditolak Fisik Mitra)
                    ▼                                  ▼                           ▼                                ▼
                 EXPIRED                            EXPIRED                     CANCELLED                        CANCELLED
```

| Status Awal | Status Akhir | Pemicu / Aksi | Aktor Berwenang | Prasyarat Bisnis | Efek Database & Kuota |
|---|---|---|---|---|---|
| *None* | `REPORTED` | `POST /api/v1/surplus-listings` | `SUPPLIER`, `ADMIN` | Validasi DTO lolos | Insert record `surplus_listings` |
| `REPORTED` | `ASSESSED` | Eksekusi otomatis di dalam pembuatan listing | `SYSTEM` | Food Safety Gate dievaluasi | Insert record `food_safety_assessments` & `rescue_score_assessments` |
| `ASSESSED` | `MATCHED` | `POST .../assign-destination` | `SUPPLIER`, `ADMIN` | Status FSG wajib `PASS` (atau `REJECT` + rute `ORGANIC`). Kapasitas mitra cukup. | `allocated_capacity_kg += qty`, `available -= qty`. Insert record `rescue_journeys` (`current_status: MATCHED`). Event `ROUTE_SELECTED` dan `MATCHED` dicatat di timeline. |
| `MATCHED` | `RESCUE_INITIATED`| `PATCH /api/v1/journeys/:id/advance-status` | `SUPPLIER`, `ADMIN` | Makanan telah diserahkan ke armada kurir penjemput | Update listing & journey ke `RESCUE_INITIATED`. Insert timeline event `RESCUE_INITIATED`. |
| `RESCUE_INITIATED`| `RECEIVED` | `POST /api/v1/journeys/:id/confirm-receipt` | `MITRA`, `ADMIN` | Makanan tiba fisik dan lolos verifikasi sensoris di dapur mitra | `allocated -= qty_reserved`, `received += actual_received_kg`. Update status ke `RECEIVED`. Insert event `RECEIVED`. |
| `MATCHED` / `RESCUE_INITIATED` | `CANCELLED` | `POST /api/v1/journeys/:id/cancel` (termasuk penolakan fisik mitra) | `MITRA`, `SUPPLIER`, `ADMIN` | Alasan pembatalan/penolakan wajib diisi | `allocated -= qty_reserved`, `available += qty_reserved`. Update journey & listing ke `CANCELLED`. Insert event `CANCELLED` dengan catatan alasan audit. **Tanpa reroute otomatis**. |
| `REPORTED` / `ASSESSED` / `MATCHED` | `EXPIRED` | Eksekusi berkala Expiry Worker (setiap 5 menit) | `SYSTEM_WORKER` | `safe_until_timestamp <= NOW()` | Jika `MATCHED`: batalkan journey (`CANCELLED`), kembalikan kapasitas mitra (`available += qty`). Update listing ke `EXPIRED`. Insert event `EXPIRED`. |

---

## 3. Modul 1: Autentikasi & Akun Pengguna (`/api/v1/auth`)

### 3.0. Daftar Akun Default Purbalingga (1 Admin, 4 Mitra, 4 Supplier)
Seluruh data database telah di-reset bersih ke wilayah **Kabupaten Purbalingga, Jawa Tengah**. Semua akun menggunakan kata sandi default: **`password123`** (juga kompatibel dengan `admin123`, `supplier123`, `mitra123`). Pengguna dapat login menggunakan `email` atau `identifier`/username alias.

| Kategori | Nama Akun / Organisasi | Username Alias | Email Resmi | Password | Koordinat (Lat, Lon) | Jarak ke Alun-Alun Kota |
|---|---|---|---|---|---|---|
| **ADMIN** | BPBD & Bappeda Purbalingga | `admin` / `admin-purbalingga` | `admin@replate.id` | `password123` | `-7.388000, 109.364500` | 0.05 km |
| **MITRA 1** | Dapur Sosial Alun-Alun Purbalingga | `purbalingga-kota` / `mitra-kota` | `mitra@replate.id` | `password123` | `-7.387500, 109.363900` | Pusat Kota |
| **MITRA 2** | Posko Pangan & Dapur Kalimanah | `purbalingga-kalimanah` / `mitra-kalimanah` | `purbalingga-kalimanah@replate.id` | `password123` | `-7.395000, 109.330000` | ~3.8 km |
| **MITRA 3** | Bank Makanan & Dapur Dhuafa Bobotsari | `purbalingga-bobotsari` / `mitra-bobotsari` | `purbalingga-bobotsari@replate.id` | `password123` | `-7.305000, 109.375000` | ~9.2 km |
| **MITRA 4** | Posko Tanggap Bencana Karangreja (Lereng Gn. Slamet) | `purbalingga-karangreja` / `mitra-karangreja` | `purbalingga-karangreja@replate.id` | `password123` | `-7.195000, 109.325000` | **~21.8 km (> 20 km)** |
| **SUPPLIER 1** | CV Surya Katering Purbalingga Kota | `supplier-kota` / `supplier` | `supplier@replate.id` | `password123` | `-7.385000, 109.360000` | 0.51 km dari Mitra 1 |
| **SUPPLIER 2** | Toko Roti & Bakery Berkah Kalimanah | `supplier-kalimanah` | `supplier-kalimanah@replate.id` | `password123` | `-7.400000, 109.335000` | 3.48 km dari Mitra 1 |
| **SUPPLIER 3** | Dapur Resto & Katering Bobotsari | `supplier-bobotsari` | `supplier-bobotsari@replate.id` | `password123` | `-7.300000, 109.380000` | 9.89 km dari Mitra 1 |
| **SUPPLIER 4** | Resto Agrowisata Lembah Asri Karangreja | `supplier-karangreja` | `supplier-karangreja@replate.id` | `password123` | `-7.190000, 109.330000` | **22.28 km dari Mitra 1 (> 20 km)** |

#### Matriks Uji Jarak Fisik & Penerimaan Notifikasi SOS (< 20 km vs > 20 km)
Gunakan matriks ini untuk memverifikasi logika filter geospasial pada UI frontend:
- **Kasus 1: Mitra 1 (Purbalingga Kota) menerbitkan sinyal darurat SOS:**
  - $\to$ Supplier 1 (Kota, 0.51 km): **Diterima** ($\le 20\text{ km}$, Proximity 100).
  - $\to$ Supplier 2 (Kalimanah, 3.48 km): **Diterima** ($\le 20\text{ km}$, Proximity 85).
  - $\to$ Supplier 3 (Bobotsari, 9.89 km): **Diterima** ($\le 20\text{ km}$, Proximity 65).
  - $\to$ Supplier 4 (Karangreja, 22.28 km): **DITOLAK / TIDAK MUNCUL** ($> 20\text{ km}$, di luar radius darurat).
- **Kasus 2: Mitra 4 (Posko Bencana Karangreja di Lereng Gunung Slamet) menerbitkan SOS:**
  - $\to$ Supplier 4 (Karangreja, 0.78 km): **Diterima** ($\le 20\text{ km}$, terdekat).
  - $\to$ Supplier 3 (Bobotsari, 13.16 km): **Diterima** ($\le 20\text{ km}$).
  - $\to$ Supplier 1 (Kota, 21.48 km): **DITOLAK / TIDAK MUNCUL** ($> 20\text{ km}$).
  - $\to$ Supplier 2 (Kalimanah, 22.82 km): **DITOLAK / TIDAK MUNCUL** ($> 20\text{ km}$).

---

### 3.1. `POST /api/v1/auth/login`
- **Tujuan:** Autentikasi pengguna menggunakan username/email dan password.
- **Role:** Publik.
- **Request Body (Mendukung `identifier` maupun `email`):**
  ```json
  {
    "identifier": "purbalingga-karangreja",
    "password": "password123"
  }
  ```
  *atau:*
  ```json
  {
    "email": "purbalingga-karangreja@replate.id",
    "password": "password123"
  }
  ```
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "statusCode": 200,
    "data": {
      "user": {
        "id": "10000000-0000-0000-0000-000000000024",
        "email": "purbalingga-karangreja@replate.id",
        "fullName": "Relawan Posko Bencana (Karangreja)",
        "role": "MITRA",
        "organization": {
          "id": "00000000-0000-0000-0000-000000000024",
          "name": "Posko Tanggap Bencana Karangreja (Lereng Gn. Slamet)",
          "type": "RECIPIENT"
        }
      },
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "expiresInSeconds": 900
    },
    "meta": { "timestamp": "2026-10-21T15:50:00.000Z" }
  }
  ```
- **Set-Cookie:** `refreshToken=...; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth; Max-Age=604800`

---

### 3.2. `POST /api/v1/auth/refresh`
- **Tujuan:** Rotasi token untuk memperbarui Access Token (15m) melalui cookie httpOnly `refreshToken`.
- **Role:** Publik (dengan cookie valid).
- **Response `200 OK`:** Pasangan access token baru dan rotasi cookie refresh token.

---

### 3.3. `POST /api/v1/auth/logout`
- **Tujuan:** Mencabut refresh token aktif di basis data dan membersihkan cookie peramban.
- **Role:** Terautentikasi (`ADMIN`, `SUPPLIER`, `MITRA`).

---

### 3.4. `GET /api/v1/auth/me`
- **Tujuan:** Mengambil profil pengguna yang sedang login untuk inisialisasi sesi frontend.
- **Role:** Terautentikasi (`ADMIN`, `SUPPLIER`, `MITRA`).

---

### 3.5. `POST /api/v1/auth/register`
- **Tujuan:** Pendaftaran akun pengguna baru mandiri (*self-onboarding*) dari modal login/register frontend.
- **Role:** Publik.
- **Request Body:**
  ```json
  {
    "username": "dapurberkah",
    "email": "kontak@dapurberkah.org",
    "password": "PasswordAman123!",
    "name": "Siti Rahma",
    "organizationName": "Dapur Barokah Matraman",
    "role": "MITRA"
  }
  ```
- **Validasi Server:**
  - `username`: String minimal 3 karakter, alfanumerik. Wajib unik.
  - `email`: Format email valid. Wajib unik.
  - `password`: Minimal 6 karakter.
  - `name`: Nama lengkap pengguna (wajib non-kosong).
  - `organizationName`: Nama badan/dapur/katering (wajib non-kosong, mendukung alias `organization` dari payload klien).
  - `role`: Enum `SUPPLIER` atau `MITRA` (bersifat case-insensitive, mendukung format huruf kecil `supplier` atau `mitra` dari klien).
- **Response `201 Created`:**
  ```json
  {
    "success": true,
    "statusCode": 201,
    "message": "Pendaftaran akun berhasil",
    "data": {
      "user": {
        "id": "e4f8b912-3c1a-4d9e-b812-7f9a0c111222",
        "username": "dapurberkah",
        "email": "kontak@dapurberkah.org",
        "fullName": "Siti Rahma",
        "role": "MITRA",
        "avatarIcon": "🤝",
        "organization": {
          "id": "99a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b5c",
          "name": "Dapur Barokah Matraman",
          "type": "RECIPIENT"
        }
      },
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "expiresInSeconds": 900
    }
  }
  ```
- **Set-Cookie:** `refreshToken=...; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth; Max-Age=604800`

---

## 4. Modul 2: Data Rujukan Master (`/api/v1/reference`)

### 4.1. `GET /api/v1/reference/food-types`
- **Tujuan:** Mengambil katalog master jenis pangan dari tabel basis data `food_types` (standar FAO/WHO/BPOM).
- **Role:** Publik / Terautentikasi.
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "statusCode": 200,
    "data": [
      {
        "id": "cooked-rice",
        "name": "Cooked Rice",
        "category": "prepared",
        "defaultPerishabilityHours": 4.0,
        "densityCategory": "high",
        "servingWeightKg": 0.20,
        "distributionEase": 82,
        "handlingNotes": "Perlu kendali suhu ketat (>60°C atau <4°C). Risiko Bacillus cereus.",
        "sourceCitation": "USDA FSIS & WHO 5 Keys to Safer Food."
      }
    ]
  }
  ```

---

### 4.2. `GET /api/v1/reference/safety-parameters`
- **Tujuan:** Mengambil kamus kosakata opsi Food Safety Gate dwibahasa (ID/EN) untuk form pelaporan.
- **Role:** Publik / Terautentikasi.

---

## 5. Modul 3: Pelaporan Surplus & Food Safety Gate (`/api/v1/surplus-listings`)

### 5.1. `POST /api/v1/surplus-listings`
- **Tujuan:** Donatur/katering mendaftarkan surplus makanan. Server mengevaluasi Food Safety Gate dan menghitung `safeUntilTimestamp`.
- **Role:** `SUPPLIER`, `ADMIN`.
- **Request Body:**
  ```json
  {
    "foodTypeId": "cooked-rice",
    "foodName": "Nasi Matang Prasmanan Katering",
    "quantity": 15,
    "unit": "kg",
    "sourceContextId": "Catering",
    "timeWindowId": "1_3h",
    "conditionId": "suitable",
    "safetyConditionId": "no_visible_damage",
    "storageHistoryId": "known_compliant",
    "storageTempId": "hot_holding_above_60",
    "preparedAt": "2026-10-15T12:30:00.000Z",
    "storageDurationHours": 1.5,
    "expiryDate": null,
    "packagingConditionId": "intact_proper",
    "handlingIntegrityId": "hygienic_separated",
    "notes": "Surplus prasmanan sesi makan siang, wadah Cambro tertutup rapat."
  }
  ```
- **Validasi Server:**
  - `preparedAt`: Tidak boleh > 5 menit di masa depan.
  - `quantity`: Angka desimal > 0.
  - `storageDurationHours`: Angka $\ge 0$.
- **Response `201 Created`:** Mengembalikan objek surplus listing berstatus `ASSESSED`, hasil Food Safety Gate, skor Rescue Score, dan `safeUntilTimestamp`.

---

### 5.2. `GET /api/v1/surplus-listings/my-dispatches`
- **Tujuan:** Endpoint khusus yang dibutuhkan oleh `SupplierDashboard.jsx` untuk menampilkan daftar kiriman aktif dan riwayat donasi milik dapur supplier yang sedang login.
- **Role:** `SUPPLIER`.
- **Query Params:** `status` (`ACTIVE` / `COMPLETED` / `ALL`), `page`, `limit`.
- **Pemetaan Frontend:** Menggantikan filter `reports.filter(r => r.reportedBy.id === user.id)` di `SupplierDashboard.jsx`.
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "statusCode": 200,
    "data": {
      "summary": {
        "activeCount": 2,
        "completedCount": 5,
        "totalRescuedKg": 82.5,
        "totalMealsSaved": 206,
        "totalRupiahSaved": 2310000,
        "safetyComplianceRatePercent": 100
      },
      "dispatches": [
        {
          "id": "7a3e5c9b-6b21-4f12-88d3-7d8b9e000101",
          "foodName": "Nasi Matang Prasmanan Katering",
          "quantity": 15,
          "unit": "kg",
          "currentLifecycleStatus": "RESCUE_INITIATED",
          "safeUntilTimestamp": "2026-10-15T16:30:00.000Z",
          "recipient": {
            "name": "Dapur Umum Mandiri",
            "type": "Community Kitchen",
            "distanceKm": 2.4
          },
          "createdAt": "2026-10-15T13:00:00.000Z"
        }
      ]
    }
  }
  ```

---

### 5.3. `GET /api/v1/surplus-listings`
- **Tujuan:** Mengambil seluruh daftar listing surplus dengan filter peran dan pagination.
- **Role:** Terautentikasi (`SUPPLIER` hanya miliknya, `MITRA` hanya yang relevan, `ADMIN` seluruh kota).

---

### 5.4. `GET /api/v1/surplus-listings/:id/assessment`
- **Tujuan:** Endpoint yang dipanggil oleh halaman `Assessment.jsx` untuk memuat rincian kartu Food Safety Gate, kalkulasi Rescue Score, rute rekomendasi, koordinat donatur, dan daftar kandidat mitra cocok terurut jarak (`distanceKm`).
- **Role:** Terautentikasi (pemilik listing atau Admin).
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "statusCode": 200,
    "data": {
      "listingId": "7a3e5c9b-6b21-4f12-88d3-7d8b9e000101",
      "foodName": "Roti Manis",
      "quantityKg": 8,
      "portions": 20,
      "donorOrganization": {
        "id": "10000000-0000-0000-0000-000000000001",
        "name": "Grand Sahid Catering & Hotel",
        "latitude": -6.208763,
        "longitude": 106.818573
      },
      "safetyAssessment": {
        "safetyStatus": "PASS",
        "gateReasons": []
      },
      "scoreAssessment": {
        "totalScore": 92,
        "recommendedRoute": "REDISTRIBUTE"
      },
      "matches": [
        {
          "recipientId": "20000000-0000-0000-0000-000000000001",
          "organizationId": "00000000-0000-0000-0000-000000000003",
          "name": "Dapur Sosial Barokah Matraman",
          "recipientType": "COMMUNITY_KITCHEN",
          "matchScore": 96,
          "availableCapacityKg": 50,
          "isLockedForReview": false,
          "canAssign": true,
          "distanceKm": 3.0,
          "estimatedTransitMinutes": 14,
          "destinationLatitude": -6.2088,
          "destinationLongitude": 106.8456,
          "supplierLatitude": -6.208763,
          "supplierLongitude": 106.818573,
          "rationale": [
            "Menerima kategori BAKERY_PASTRY",
            "Kapasitas sisa (50 kg) mencukupi kebutuhan (8 kg)",
            "Jarak ke mitra: 3 km (estimasi penjemputan ~14 mnt)"
          ]
        }
      ]
    }
  }
  ```

---

### 5.5. `GET /api/v1/surplus-listings/:id/matches`
- **Tujuan:** Mengambil daftar kandidat mitra cocok terurut skor dan jarak geospasial (kompatibel langsung dengan `api.surplus.getMatches(id)`).
- **Role:** Terautentikasi (`SUPPLIER`, `ADMIN`).
- **Response `200 OK`:** Array of `MatchedRecipient` (identik dengan array `matches` pada `assessment`).

---

### 5.6. `PUT /api/v1/surplus-listings/:id/safety-parameters`
- **Tujuan:** Memperbarui parameter keselamatan makanan (misal saat melengkapi data yang berstatus `REVIEW` via `EditSafetyModal.jsx`).
- **Role:** `SUPPLIER` (pemilik listing), `ADMIN`.
- **Efek:** Mengevaluasi ulang Food Safety Gate dan menghitung ulang `safeUntilTimestamp`.

---

### 5.6. `DELETE /api/v1/surplus-listings/:id`
- **Tujuan:** Menghapus laporan surplus makanan dengan mekanisme *soft delete* terproteksi tombstone (dipanggil oleh frontend `api.surplus.delete(id)`).
- **Role:** `SUPPLIER` (pemilik listing), `ADMIN`.
- **Prekondisi Bisnis & State Machine:**
  - Hanya diizinkan jika siklus hidup masih berstatus `REPORTED` atau `ASSESSED`.
  - Jika listing sudah berstatus `MATCHED`, `RESCUE_INITIATED`, atau `RECEIVED`, server **menolak penghapusan dengan 400 Bad Request** karena armada logistik atau mitra penerima telah terikat. Pembatalan harus melalui endpoint `POST /journeys/:id/cancel`.
- **Efek Database:**
  - Menandai baris `is_deleted = true`, `deleted_at = NOW()`.
  - Mencatat entri audit log `action: 'DELETE'` di tabel `audit_logs`.
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "statusCode": 200,
    "message": "Laporan surplus berhasil dihapus."
  }
  ```

---

## 6. Modul 4: Pencocokan Mitra & Alokasi Kuota (`/api/v1/surplus-listings/:id/matches`)

### 6.1. `GET /api/v1/surplus-listings/:id/matches`
- **Tujuan:** Menampilkan kandidat mitra penampung terdekat yang kompatibel.
- **Role:** `SUPPLIER` (pemilik), `ADMIN`.
- **Aturan Integritas Keamanan Pangan:**
  - Jika Food Safety Gate berstatus `REVIEW`: Kandidat mitra konsumsi manusia **hanya disajikan sebagai data informatif yang terkunci** (`isLockedForReview: true`). API menolak setiap upaya pemesanan kuota selama status belum berstatus `PASS`.
  - Jika Food Safety Gate berstatus `REJECT`:
    - Rute `SAFE_DISPOSAL`: Mengembalikan array kosong `[]`.
    - Rute `ORGANIC`: Hanya mengembalikan mitra daur ulang kompos industri (`preferredRoutes` mencakup `ORGANIC`).
  - Jika berstatus `PASS`: Mengembalikan daftar mitra konsumsi manusia yang diurutkan berdasar skor kecocokan tertinggi.

---

### 6.2. `POST /api/v1/surplus-listings/:id/assign-destination`
- **Tujuan:** Memasangkan surplus dengan mitra terpilih dan **mencadangkan kapasitas harian mitra secara atomik**.
- **Role:** `SUPPLIER` (pemilik), `ADMIN`.
- **Request Body:**
  ```json
  {
    "recipientProfileId": "dest-kitchen-alpha-01",
    "confirmedOrganicDispatch": false
  }
  ```
- **Aturan Transaksi ACID & Concurrency:**
  1. Kunci baris kapasitas mitra penerima: `SELECT ... FROM recipient_capacities ... FOR UPDATE`.
  2. Periksa apakah `available_capacity_kg >= quantity_in_kg`. Jika tidak cukup, batalkan dan kembalikan `409 Conflict`.
  3. Potong kuota: `allocated_capacity_kg += quantity_in_kg`, `available_capacity_kg -= quantity_in_kg`.
  4. Perbarui status listing ke `MATCHED`.
  5. Buat baris baru di `rescue_journeys` dengan `current_status: 'MATCHED'`.
  6. Catat peristiwa di `journey_timeline_events`.

---

## 7. Modul 5: Logistik, Kapasitas & Konfirmasi Penerimaan (`/api/v1/journeys`, `/api/v1/recipients`)

### 7.1. `GET /api/v1/recipients/my-capacity`
- **Tujuan:** Endpoint yang dipanggil oleh `MitraDashboard.jsx` untuk mengambil ringkasan kapasitas daya tampung harian dan status aktif dapur mitra yang sedang login.
- **Role:** `MITRA`.
- **Pemetaan Frontend:** Menggantikan pembacaan kapasitas statis di `MitraDashboard.jsx`.
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "statusCode": 200,
    "data": {
      "recipientId": "dest-kitchen-alpha-01",
      "recipientName": "Dapur Umum Mandiri",
      "capacityDate": "2026-10-15",
      "maxCapacityKg": 50.0,
      "allocatedCapacityKg": 15.0,
      "receivedCapacityKg": 14.5,
      "availableCapacityKg": 20.5,
      "isAcceptingIntake": true,
      "operatingHours": "10:00 - 21:30"
    }
  }
  ```

---

### 7.2. `GET /api/v1/journeys`
- **Tujuan:** Mengambil daftar pengiriman untuk halaman `Journey.jsx`.
- **Role:** Terautentikasi (`SUPPLIER` melihat pengiriman keluar, `MITRA` melihat kiriman pasokan masuk, `ADMIN` seluruh kota).
- **Query Params:** `filter` (`ALL`, `ACTIVE`, `COMPLETED`, `CANCELLED`), `page`, `limit`.

---

### 7.3. `PATCH /api/v1/journeys/:id/advance-status`
- **Tujuan:** Memajukan status pengiriman saat penyerahan makanan ke kurir armada penjemput.
- **Role:** `SUPPLIER` (pemilik donasi), `ADMIN`.
- **Request Body:**
  ```json
  {
    "targetStatus": "RESCUE_INITIATED",
    "note": "Makanan telah diserahkan kepada armada kurir.",
    "concurrencyVersion": 1
  }
  ```
- **Validasi:** Hanya mengizinkan transisi maju dari `MATCHED` ke `RESCUE_INITIATED`. Transisi langsung ke `RECEIVED` melalui endpoint ini ditolak dengan `400 Bad Request`.

---

### 7.4. `POST /api/v1/journeys/:id/confirm-receipt`
- **Tujuan:** **Konfirmasi serah terima fisik di tujuan.** Mengunci transaksi dan mencatat berat aktual.
- **Role:** `MITRA` (organisasi penerima tujuan), `ADMIN`.
- **Request Body:**
  ```json
  {
    "actualReceivedKg": 14.5,
    "recipientNotes": "Makanan diterima hangat (>60°C), wadah bersih utuh."
  }
  ```
- **Aturan Transaksi Database:**
  1. Kunci baris journey: `SELECT ... FOR UPDATE`.
  2. Perbarui kuota harian: `allocated_capacity_kg -= qty_reserved`, `received_capacity_kg += actualReceivedKg`, dan sesuaikan `available_capacity_kg`.
  3. Ubah status journey & listing menjadi `RECEIVED`.
  4. Catat event `RECEIVED` di `journey_timeline_events`.

---

### 7.5. `POST /api/v1/journeys/:id/cancel` (Penolakan Fisik di Lokasi Mitra & Insiden Transit)
- **Tujuan:** Membatalkan pengiriman karena kendala logistik, **pelaporan kendala insiden in-transit**, atau **pelaporan penolakan fisik makanan saat kurir tiba di lokasi mitra penerima (doorstep rejection)**.
- **Role:** `MITRA` (penerima tujuan), `SUPPLIER` (sebelum kurir jalan), `ADMIN`.
- **Request Body:**
  ```json
  {
    "cancellationReason": "Suhu penyimpanan di luar toleransi (makanan telah dingin dan berbau asam saat tiba)",
    "isIncidentReport": true,
    "issueReportedBy": "Dapur Barokah Matraman",
    "note": "Pemeriksaan organoleptik fisik gagal di pintu penerimaan dapur umum."
  }
  ```
- **Validasi:** `cancellationReason` wajib string non-kosong minimal 5 karakter.
- **Aturan Integritas & Konsekuensi Kapasitas (ADR-008):**
  1. Kunci baris kapasitas mitra penerima: `SELECT ... FOR UPDATE`.
  2. Kembalikan kuota yang dicadangkan: `allocated_capacity_kg -= qty_reserved`, `available_capacity_kg += qty_reserved`.
  3. Ubah status journey dan status listing menjadi `CANCELLED`.
  4. Simpan `cancellation_reason`, `cancelled_at: NOW()`, dan `cancelled_by_user_id` di `rescue_journeys`.
  5. Catat event `CANCELLED` di `journey_timeline_events` dan `audit_logs` dengan label `[KENDALA PENGIRIMAN]` jika `isIncidentReport: true`.
  6. **Tanpa Reroute Otomatis:** Sistem tidak mengalihkan makanan yang ditolak ke rute lain secara otomatis demi perlindungan keselamatan publik.

---

## 8. Modul 6: Kinerja Penyelamatan & Analitik (`/api/v1/analytics`)

### 8.1. `GET /api/v1/analytics/performance`
- **Tujuan:** Menyediakan 4 KPI operasional, funnel alur rantai pasok, dan estimasi lingkungan sekunder (hanya dari transaksi `RECEIVED`) untuk halaman `Impact.jsx` dan `AdminDashboard.jsx`.
- **Role:** Publik / Terautentikasi.

---

### 8.2. `GET /api/v1/analytics/insights`
- **Tujuan:** Deteksi pola surplus berulang dan rekomendasi pencegahan di hulu untuk halaman `Insights.jsx`.
- **Role:** Terautentikasi.

---

## 9. Modul 7: Simulasi & Pengelolaan Data Demo (`/api/v1/admin/simulation`)

### 9.1. `POST /api/v1/admin/simulation/load-demo`
- **Tujuan:** Memuat 5 catatan demo terverifikasi untuk evaluasi prototipe.
- **Role:** `ADMIN`.

---

### 9.2. `DELETE /api/v1/admin/simulation/clear-demo`
- **Tujuan:** Membersihkan data simulasi bertanda `is_demo = true` tanpa menghapus data donasi asli.
- **Role:** `ADMIN`.

---

## 10. Modul 8: Permohonan Distribusi Darurat (`/api/v1/emergency-requests`)

Modul ini melayani fitur **Pusat Permintaan Pangan Mendesak (`EmergencyDistribution.jsx`)** pada portal mitra penerima, memungkinkan mitra mengajukan permohonan bantuan makanan darurat (*pull-based*), mencocokkannya dengan surplus aktif yang aman, serta mengalokasikan donasi.

### 10.1. `POST /api/v1/emergency-requests`
- **Tujuan:** Membuat permohonan bantuan pangan darurat baru.
- **Role:** `MITRA`, `ADMIN`.
- **Request Body:**
  ```json
  {
    "neededFoodType": "cooked_meals",
    "foodTypeName": "Makanan Siap Santap / Nasi Kotak",
    "requestedPortions": 50,
    "beneficiaryCount": 50,
    "beneficiaryGroup": "Warga Terdampak Banjir & Pengungsi",
    "targetLocation": "Posko Dapur Umum Mandiri, Tebet Barat, Jakarta Selatan",
    "urgencyLevel": "CRITICAL",
    "urgencyDeadline": "Hari ini sebelum 12:30 WIB (Makan Siang)",
    "urgencyReason": "Lonjakan pengungsi baru sebanyak 50 jiwa, stok logistik habis.",
    "contactPerson": "Ibu Siti Rahma (Koordinator)",
    "contactPhone": "0812-3456-7890",
    "notes": "Diutamakan makanan hangat tertutup."
  }
  ```
- **Validasi Server:**
  - `requestedPortions` > 0.
  - `beneficiaryCount` > 0.
  - `targetLocation`, `urgencyReason`, `contactPhone` wajib diisi.
- **Response `201 Created`:** Mengembalikan entitas `EmergencyFoodRequest` berstatus `OPEN`.

---

### 10.2. `GET /api/v1/emergency-requests`
- **Tujuan:** Mengambil daftar permohonan pangan darurat dengan paginasi dan filter.
- **Role:** Terautentikasi (`MITRA`, `SUPPLIER`, `ADMIN`).
- **Query Params:** `status` (`OPEN` / `ALLOCATED` / `FULFILLED` / `CANCELLED`), `urgencyLevel` (`CRITICAL` / `HIGH` / `MEDIUM`), `page`, `limit`.
- **Response `200 OK`:** Array daftar permohonan darurat aktif (entitas dengan `isDeleted: true` disaring otomatis).

---

### 10.3. `GET /api/v1/emergency-requests/:id`
- **Tujuan:** Mendapatkan rincian lengkap permohonan darurat beserta relasi mitra pemohon dan surplus yang dialokasikan (jika ada).
- **Role:** Terautentikasi.

---

### 10.4. `GET /api/v1/emergency-requests/:id/matching-surplus`
- **Tujuan:** Mengidentifikasi kandidat surplus aktif yang dapat memenuhi permohonan darurat ini, terurut dari lokasi donor terdekat (`distanceKm` ascending).
- **Role:** `MITRA` (pemilik permohonan), `ADMIN`.
- **Aturan Ketat Keamanan Pangan (Food Safety Guardrail):**
  - Surplus listing **Wajib berstatus `PASS`** pada Food Safety Gate.
  - Surplus listing berstatus `REVIEW` atau `REJECT` **DILARANG MUNCUL**.
  - Rute rekomendasi wajib layak konsumsi manusia (`REDISTRIBUTE` atau `PROCESS`).
  - Status listing saat ini harus `REPORTED` atau `ASSESSED`.
  - Waktu aman belum kedaluwarsa (`safeUntilTimestamp > NOW()`).
- **Atribut Geospasial Response:**
  - Setiap listing diperkaya dengan field `distanceKm` (jarak geodetik Haversine ke posko dalam km) dan `estimatedTransitMinutes` (estimasi waktu tiba kurir).
  - Diurutkan dari donor terdekat untuk mempercepat respons penanggulangan bencana.

---

### 10.5. `POST /api/v1/emergency-requests/:id/allocate`
- **Tujuan:** Mengalokasikan laporan surplus donor ke permohonan darurat secara atomik.
- **Role:** `MITRA` (pemilik permohonan), `ADMIN`.
- **Request Body:**
  ```json
  {
    "surplusListingId": "7a3e5c9b-6b21-4f12-88d3-7d8b9e000101",
    "notes": "Dialokasikan untuk pemenuhan kebutuhan pengungsi banjir."
  }
  ```
- **Aturan Transaksi Database (`$transaction`):**
  1. Kunci baris emergency request & surplus listing: `SELECT ... FOR UPDATE`.
  2. Verifikasi status emergency request adalah `OPEN`.
  3. Verifikasi status surplus listing adalah `REPORTED` atau `ASSESSED` dan **Food Safety Gate berstatus `PASS`**.
  4. Periksa dan cadangkan kapasitas harian mitra penerima (`allocated_capacity_kg += quantityKg`).
  5. Buat entitas `RescueJourney` dengan status `MATCHED`.
  6. Perbarui status `SurplusListing` menjadi `MATCHED`.
  7. Perbarui status `EmergencyFoodRequest` menjadi `ALLOCATED` dengan referensi `matchedSurplusId` dan `matchedAt`.
  8. Tambahkan event di `journey_timeline_events` dan `audit_logs`.
- **Response `200 OK`:** Objek permohonan darurat berstatus `ALLOCATED` beserta rincian perjalanan donasi.

---

### 10.6. `PATCH /api/v1/emergency-requests/:id/status`
- **Tujuan:** Memperbarui status permohonan darurat secara manual (misal: menandai `FULFILLED` saat makanan tiba di posko, atau `CANCELLED`).
- **Role:** `MITRA` (pemilik), `ADMIN`.
- **Request Body:**
  ```json
  {
    "status": "CANCELLED",
    "cancelReason": "Kebutuhan telah terpenuhi dari sumber dapur logistik lain."
  }
  ```

---

### 10.7. `DELETE /api/v1/emergency-requests/:id`
- **Tujuan:** Menghapus permohonan darurat (*soft delete* tombstone) agar tidak muncul kembali saat sinkronisasi multi-device.
- **Role:** `MITRA` (pemilik), `ADMIN`.
- **Efek Database:** Set `is_deleted = true`, `deleted_at = NOW()`, catat `AuditLog`.
- **Response `200 OK`:** Konfirmasi keberhasilan penghapusan.

---

## 11. Endpoint Siaran Darurat SOS (*Emergency Food Broadcasts*)

### 11.1. `GET /api/v1/emergency-broadcasts/active`
- **Tujuan:** Mengambil seluruh siaran darurat SOS aktif yang belum kedaluwarsa untuk penyedia surplus/katering.
- **Role:** `SUPPLIER`, `ADMIN`.
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "uuid-broadcast",
        "emergencyRequestId": "uuid-req",
        "recipientOrgName": "Dapur Posko Banjir Matraman",
        "recipientLocation": "Jl. Matraman No. 12, Jakarta",
        "neededFoodType": "cooked_meals",
        "foodTypeName": "Makanan Siap Santap / Nasi Kotak",
        "requestedPortions": 60,
        "targetQuantityKg": 21.0,
        "urgencyLevel": "CRITICAL",
        "urgencyDeadline": "Sebelum 12:30 WIB",
        "urgencyReason": "40 pengungsi baru datang...",
        "contactPerson": "Ibu Siti Rahma",
        "contactPhone": "0812-3456-7890",
        "radiusKm": 10.0,
        "expiresAt": "2026-10-21T14:30:00.000Z",
        "status": "ACTIVE",
        "hasResponded": false
      }
    ]
  }
  ```

---

### 11.2. `GET /api/v1/emergency-broadcasts/my-responses`
- **Tujuan:** Mengambil riwayat bantuan darurat yang telah dikonfirmasi oleh penyedia surplus yang sedang login.
- **Role:** `SUPPLIER`, `ADMIN`.
- **Response `200 OK`:** Daftar objek `SupplierBroadcastResponse` beserta data siaran dan status perjalanan logistik.

---

### 11.3. `POST /api/v1/emergency-broadcasts/:broadcastId/respond`
- **Tujuan:** Konfirmasi kesediaan penyedia surplus untuk mengirimkan bantuan pangan darurat secara instan satu-klik.
- **Role:** `SUPPLIER`, `ADMIN`.
- **Request Body:**
  ```json
  {
    "notes": "Tersedia 60 porsi nasi kotak ayam bakar baru matang, dikemas higienis."
  }
  ```
- **Aturan Transaksi Database (`$transaction`):**
  1. Kunci baris siaran broadcast dengan `SELECT ... FOR UPDATE` dan pastikan berstatus `ACTIVE` dan belum kedaluwarsa.
  2. Cegah respons duplikat dari organisasi supplier yang sama (`409 Conflict`).
  3. Otomatis buat `SurplusListing` dengan `isEmergencyResponse = true` dan status `MATCHED`.
  4. Otomatis buat `FoodSafetyAssessment` berstatus `PASS` berbasis atestasi darurat donor.
  5. Otomatis buat `RescueScoreAssessment` dan `RescueJourney` berstatus `MATCHED`.
  6. Catat `SupplierBroadcastResponse` dan mutasikan `EmergencyBroadcast.status` $\to$ `RESPONDED` serta `EmergencyFoodRequest.status` $\to$ `ALLOCATED`.
  7. Catat `AuditLog`.
- **Response `200 OK`:** Objek respons, journey baru, dan surplus listing darurat.

---

### 11.4. `PATCH /api/v1/emergency-broadcasts/:broadcastId/status`
- **Tujuan:** Pengaturan status siaran darurat administratif.
- **Role:** `ADMIN`.

---

## 12. Modul 9: Pengaturan Profil, Alamat & Keamanan Akun (`/api/v1/profile`)

Modul ini melayani fitur **Manajemen Profil Pengguna, Alamat Fisik, Koordinat Geospasial (Latitude & Longitude), dan Keamanan Akun (`ProfileSettings.jsx`)**.

### 12.1. `GET /api/v1/profile`
- **Tujuan:** Mengambil data profil lengkap pengguna yang sedang login beserta data organisasi, koordinat geospasial, dan spesifikasi fasilitas (jika role `MITRA`).
- **Role:** Terautentikasi (`ADMIN`, `SUPPLIER`, `MITRA`).
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "statusCode": 200,
    "data": {
      "user": {
        "id": "10000000-0000-0000-0000-000000000003",
        "email": "mitra@replate.id",
        "fullName": "Ahmad Pengelola Dapur",
        "role": "MITRA",
        "isActive": true,
        "createdAt": "2026-10-21T08:00:00.000Z",
        "updatedAt": "2026-10-21T14:30:00.000Z"
      },
      "organization": {
        "id": "00000000-0000-0000-0000-000000000003",
        "name": "Dapur Sosial Barokah Matraman",
        "type": "RECIPIENT",
        "address": "Jl. Matraman Raya No. 42, Jakarta Timur",
        "contactPhone": "0812-3456-7890",
        "contactEmail": "dapur@barokah.org",
        "latitude": -6.2088,
        "longitude": 106.8456,
        "isVerified": true
      },
      "recipientProfile": {
        "id": "20000000-0000-0000-0000-000000000001",
        "recipientType": "COMMUNITY_KITCHEN",
        "dailyMaxCapacityKg": 100,
        "hasRefrigeration": true,
        "hasFreezer": true,
        "acceptedFoodCategories": ["COOKED_MEALS", "BAKERY_PASTRY", "FRESH_PRODUCE"],
        "latitude": -6.2088,
        "longitude": 106.8456
      }
    }
  }
  ```

---

### 12.2. `PUT /api/v1/profile`
- **Tujuan:** Memperbarui data pengguna, nama organisasi, nomor narahubung, alamat fisik, titik koordinat geospasial, serta spesifikasi operasional penerima.
- **Role:** Terautentikasi (`ADMIN`, `SUPPLIER`, `MITRA`).
- **Request Body:**
  ```json
  {
    "fullName": "Ahmad Pengelola Posko Dapur",
    "organizationName": "Dapur Barokah Matraman",
    "address": "Jl. Matraman Raya No. 50, Jakarta Timur",
    "contactPhone": "0812-3456-7890",
    "contactEmail": "dapur@barokah.org",
    "latitude": -6.208800,
    "longitude": 106.845600,
    "recipientProfile": {
      "recipientType": "COMMUNITY_KITCHEN",
      "dailyMaxCapacityKg": 100,
      "hasRefrigeration": true,
      "hasFreezer": true,
      "acceptedFoodCategories": ["COOKED_MEALS", "BAKERY_PASTRY", "FRESH_PRODUCE"]
    }
  }
  ```
- **Validasi Server:**
  - `latitude`: Rentang valid $-90.0 \le \text{lat} \le 90.0$.
  - `longitude`: Rentang valid $-180.0 \le \text{lon} \le 180.0$.
  - `recipientProfile.dailyMaxCapacityKg`: Minimal $1\text{ kg}$.
- **Efek Basis Data:**
  - Berjalan dalam transaksi `$transaction`.
  - Sinkronisasi otomatis koordinat `latitude` dan `longitude` dari `Organization` ke `RecipientProfile` (jika role `MITRA`).
  - Pembaruan kuota `RecipientCapacity.maxCapacityKg` dan `availableCapacityKg` hari ini jika kapasitas harian diubah.
  - Pencatatan `AuditLog` dengan aksi `UPDATE` pada tabel `users`.
- **Response `200 OK`:** Data profil lengkap yang telah diperbarui.

---

### 12.3. `PUT /api/v1/profile/password`
- **Tujuan:** Mengubah kata sandi akun pengguna dengan verifikasi kata sandi lama dan enkripsi Argon2id.
- **Role:** Terautentikasi (`ADMIN`, `SUPPLIER`, `MITRA`).
- **Request Body:**
  ```json
  {
    "currentPassword": "passwordLama123",
    "newPassword": "passwordBaruRahasia456!"
  }
  ```
- **Validasi Server:**
  - `currentPassword`: Wajib diverifikasi dengan hash tersimpan di database via `argon2.verify()`.
  - `newPassword`: Minimal 6 karakter dan tidak boleh identik dengan kata sandi saat ini.
- **Efek Basis Data:**
  - Hash kata sandi baru menggunakan algoritma Argon2id.
  - Pencabutan (*revocation*) seluruh sesi `RefreshToken` aktif pengguna (`isRevoked = true`).
  - Pencatatan `AuditLog` tanpa membocorkan kata sandi mentah maupun hash.
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "statusCode": 200,
    "message": "Kata sandi berhasil diperbarui. Silakan gunakan kata sandi baru untuk sesi berikutnya."
  }
  ```
