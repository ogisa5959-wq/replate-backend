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

### 3.1. `POST /api/v1/auth/login`
- **Tujuan:** Autentikasi pengguna menggunakan username/email dan password.
- **Role:** Publik.
- **Request Body:**
  ```json
  {
    "identifier": "supplier",
    "password": "supplier123"
  }
  ```
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "statusCode": 200,
    "data": {
      "user": {
        "id": "c1f8a847-8a1e-48a5-b1a7-0e6e8a000001",
        "username": "supplier",
        "email": "catering@replate.id",
        "fullName": "Dapur Grand Catering",
        "role": "SUPPLIER",
        "avatarIcon": "🏪",
        "organization": {
          "id": "org-grand-catering-01",
          "name": "PT Boga Berkah Katering",
          "type": "SUPPLIER"
        }
      },
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "expiresInSeconds": 900
    },
    "meta": { "timestamp": "2026-10-15T14:48:00.000Z" }
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
- **Tujuan:** Endpoint yang dipanggil oleh halaman `Assessment.jsx` untuk memuat rincian kartu Food Safety Gate, kalkulasi Rescue Score, rute rekomendasi, dan alasan evaluasi.
- **Role:** Terautentikasi (pemilik listing atau Admin).
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "statusCode": 200,
    "data": {
      "listingId": "7a3e5c9b-6b21-4f12-88d3-7d8b9e000101",
      "foodSafetyGate": {
        "status": "PASS",
        "eligibleForConsumptionRecommendation": true,
        "headline": "LOLOS PEMERIKSAAN AWAL KEAMANAN PANGAN",
        "summary": "Berdasarkan parameter yang dilaporkan, memenuhi standar baseline.",
        "reasons": [],
        "missingInformation": []
      },
      "rescueAssessment": {
        "score": 92,
        "priority": "HIGH PRIORITY",
        "recommendedRoute": "REDISTRIBUTE",
        "rationale": "Surplus ini memperoleh Skor Penyelamatan 92/100...",
        "breakdown": {
          "condition": { "score": 88, "weight": 0.3, "contribution": 26.4 },
          "urgency": { "score": 90, "weight": 0.25, "contribution": 22.5 },
          "quantity": { "score": 95, "weight": 0.15, "contribution": 14.3 },
          "distributionEase": { "score": 82, "weight": 0.15, "contribution": 12.3 },
          "destinationCompatibility": { "score": 95, "weight": 0.15, "contribution": 14.3 }
        }
      }
    }
  }
  ```

---

### 5.5. `PUT /api/v1/surplus-listings/:id/safety-parameters`
- **Tujuan:** Memperbarui parameter keselamatan makanan (misal saat melengkapi data yang berstatus `REVIEW` via `EditSafetyModal.jsx`).
- **Role:** `SUPPLIER` (pemilik listing), `ADMIN`.
- **Efek:** Mengevaluasi ulang Food Safety Gate dan menghitung ulang `safeUntilTimestamp`.

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

### 7.5. `POST /api/v1/journeys/:id/cancel` (Penolakan Fisik di Lokasi Mitra)
- **Tujuan:** Membatalkan pengiriman karena kendala logistik atau **pelaporan penolakan fisik makanan saat kurir tiba di lokasi mitra penerima**.
- **Role:** `MITRA` (penerima tujuan), `SUPPLIER` (sebelum kurir jalan), `ADMIN`.
- **Request Body:**
  ```json
  {
    "cancellationReason": "Suhu penyimpanan di luar toleransi (makanan telah dingin dan berbau asam saat tiba)",
    "note": "Pemeriksaan organoleptik fisik gagal di pintu penerimaan dapur umum."
  }
  ```
- **Validasi:** `cancellationReason` wajib string non-kosong minimal 5 karakter.
- **Aturan Integritas & Konsekuensi Kapasitas (ADR-008):**
  1. Kunci baris kapasitas mitra penerima: `SELECT ... FOR UPDATE`.
  2. Kembalikan kuota yang dicadangkan: `allocated_capacity_kg -= qty_reserved`, `available_capacity_kg += qty_reserved`.
  3. Ubah status journey dan status listing menjadi `CANCELLED`.
  4. Simpan `cancellation_reason`, `cancelled_at: NOW()`, dan `cancelled_by_user_id` di `rescue_journeys`.
  5. Catat event `CANCELLED` di `journey_timeline_events` dan `audit_logs`.
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
