# REPLATE Backend — Known Issues & Problem Backlog

Dokumen ini mencatat masalah yang telah diverifikasi (*verified issues*), batasan teknis prototipe saat ini, serta hal-hal yang membutuhkan penanganan saat implementasi backend REPLATE berlangsung.

---

## 1. Daftar Masalah Terverifikasi (Known Issues Tracker)

| ID Masalah | Area / Modul | Tingkat Keparahan | Status | Deskripsi Masalah | Rencana Resolusi di Backend |
|---|---|---|---|---|---|
| **KI-001** | Frontend / Report Surplus | 🟡 Sedang | `RESOLVED_IN_BACKEND` | **Transient State Gap:** Pada form `ReportSurplus.jsx`, saat form disubmit, data hanya disimpan di React state (`pendingReport`) dan belum disimpan ke `localStorage`. Data baru disimpan permanen setelah user memilih mitra di halaman `Assessment.jsx`. Jika user menutup browser di halaman Assessment, data surplus hilang. | Backend menyediakan endpoint `POST /api/v1/surplus-listings` yang langsung menyimpan draft listing berstatus `REPORTED`/`ASSESSED` saat form dikirimkan, sehingga data tidak hilang. |
| **KI-002** | Data / Destinasi & Kapasitas | 🔴 Kritis | `RESOLVED_IN_BACKEND` | **Static Capacity / Double Allocation Risk:** Data mitra penampung di `src/data/destinations.js` memiliki kapasitas harian statis (`currentAvailableCapacityKg`). Di frontend, memilih mitra tidak mengurangi kuota kapasitas secara persisten, memungkinkan *overbooking* jika beberapa donasi terjadi bersamaan. | Backend menerapkan tabel `recipient_capacities` terlindungi transaksi ACID dengan *pessimistic row locking* (`SELECT ... FOR UPDATE`) dan check constraint `available_capacity_kg >= 0`. |
| **KI-003** | Auth / Keamanan | 🔴 Kritis | `RESOLVED_IN_BACKEND` | **Plaintext Demo Credentials:** Sesi pengguna di `src/utils/storage.js` menyimpan password teks polos (`admin123`, `supplier123`, `mitra123`) di `localStorage`, dan pemeriksaan role hanya dilakukan di sisi klien. | Backend mengimplementasikan hash Argon2id/bcrypt, token JWT jangka pendek (15 menit), refresh token hash SHA-256 di DB, dan `RolesGuard` di sisi server. |
| **KI-004** | Lifecycle / Expiry | 🟡 Sedang | `RESOLVED_IN_BACKEND` | **No Background Expiry Mechanism:** Makanan siap santap dengan batas waktu aman `under_1h` tidak memiliki mekanisme kedaluwarsa otomatis jika tidak ada mitra yang mengambil. | Backend mengimplementasikan cron worker internal (`@nestjs/schedule`) setiap 5 menit (`*/5 * * * *`) yang memeriksa `safe_until_timestamp` UTC, membatalkan listing `MATCHED` serta melepaskan kapasitas mitra, dan menandai `EXPIRED` pada listing `REPORTED`. |
| **KI-005** | Storage / Demo Mock | 🟢 Rendah | `RESOLVED_IN_BACKEND` | **Hardcoded Relative Timestamps in Demo Data:** Data demo di `storage.js` menggunakan fungsi `h(hours)` yang menghasilkan timestamp relatif terhadap `Date.now()`. Hal ini menyebabkan urutan demo berubah-ubah tergantung saat dimuat. | Seed data backend menggunakan timestamp terstruktur yang konsisten dan dapat direproduksi (*idempotent seed*). |
| **KI-006** | Domain / Food Safety | 🟡 Sedang | `RESOLVED_IN_BACKEND` | **Absence of Physical Rejection Protocol:** Belum ada alur eksplisit jika makanan yang lolos gerbang digital ternyata mengalami kerusakan organoleptik saat tiba di lokasi mitra penerima (*doorstep rejection*). | Menggunakan endpoint `POST /api/v1/journeys/:id/cancel` dengan status `CANCELLED`, alasan penolakan wajib, audit trail lengkap, dan pemulihan kapasitas mitra seketika. **Tanpa reroute otomatis** ke `ORGANIC`/kompos. |

---

## 2. Rincian Masalah & Langkah Mitigasi

### KI-001: Transient State Gap pada Pelaporan Surplus
- **Komponen Terdampak:** `replate-frontend/src/pages/ReportSurplus.jsx`, `replate-frontend/src/App.jsx`
- **Gejala:** Pengguna mengisi formulir laporan makanan, menekan "Lanjut ke Penilaian & Rute", masuk ke halaman `Assessment.jsx`. Jika tab browser tidak sengaja tertutup atau koneksi terputus sebelum memilih mitra di Assessment, seluruh data inputan pengguna lenyap.
- **Mitigasi Backend:** Endpoint `POST /api/v1/surplus-listings` akan dipanggil langsung ketika tombol "Lanjut ke Penilaian" ditekan. Server menyimpan entitas `surplus_listings` dengan status `ASSESSED` dan mengembalikan `listingId`. Halaman Assessment kemudian cukup memuat `listingId` tersebut.

### KI-002: Risiko Alokasi Ganda pada Kapasitas Mitra
- **Komponen Terdampak:** `replate-frontend/src/data/destinations.js`, `replate-frontend/src/engine/matchingEngine.js`
- **Gejala:** Dua pengguna donatur secara bersamaan memilih `Community Kitchen Alpha` (kapasitas sisa 20 kg). Donatur 1 meminta 15 kg, Donatur 2 meminta 12 kg. Karena kapasitas tidak terkunci di server terpusat, kedua donasi disetujui, menyebabkan penerima kelebihan beban (27 kg).
- **Mitigasi Backend:** Transaksi `prisma.$transaction` dengan `tx.$queryRaw` `SELECT ... FOR UPDATE` pada tabel `recipient_capacities`. Jika kuota tersisa tidak mencukupi, transaksi dibatalkan dan API mengembalikan HTTP `409 Conflict`.

### KI-003: Kredensial Teks Polos & Ketiadaan Otorisasi Server
- **Komponen Terdampak:** `replate-frontend/src/utils/storage.js` (`DEMO_USERS`)
- **Gejala:** Siapa pun dapat memanipulasi `localStorage.getItem('replate_user_session_v1')` melalui konsol pengembang peramban untuk menyamar sebagai admin atau mitra lain tanpa verifikasi server.
- **Mitigasi Backend:** Setiap mutasi data diverifikasi oleh JWT `JwtAuthGuard` dan `OwnershipGuard`. Server memeriksa ID organisasi pengguna dan menolak akses jika pengguna mencoba memodifikasi data milik organisasi lain (`403 Forbidden`).

### KI-004: Ketiadaan Mekanisme Kedaluwarsa Otomatis di Latar Belakang
- **Komponen Terdampak:** `replate-frontend/src/data/foods.js` (`TIME_WINDOWS`), `replate-frontend/src/pages/Journey.jsx`
- **Gejala:** Donasi makanan siap santap dengan safe time window sempit (`under_1h`) dapat tetap menggantung berstatus `REPORTED` atau `MATCHED` selama berhari-hari jika tidak ada pengantaran, berpotensi dikonsumsi setelah busuk.
- **Mitigasi Backend:** Scheduler berkala `@nestjs/schedule` berjalan setiap 5 menit (`*/5 * * * *`). Memeriksa `safe_until_timestamp <= NOW()`. Status `REPORTED` diubah menjadi `EXPIRED`. Status `MATCHED` diubah menjadi `CANCELLED` dan kapasitas reservasi mitra dipulihkan seketika. Transaksi `RESCUE_INITIATED` diberi flag peringatan tanpa dibatalkan sepihak di jalan.

### KI-006: Protokol Penolakan Fisik di Lokasi Mitra Penerima (Doorstep Rejection)
- **Komponen Terdampak:** `replate-frontend/src/components/JourneyTimeline.jsx`, `replate-frontend/src/pages/MitraDashboard.jsx`
- **Gejala:** Makanan yang lolos asesmen input awal dapat rusak dalam perjalanan (suhu naik, kemasan pecah, bau asam). Di frontend belum ada tombol bagi mitra untuk menolak kiriman yang tidak layak di lokasi.
- **Mitigasi Backend:** Endpoint `POST /api/v1/journeys/:id/cancel` dengan role `MITRA` berwenang melaporkan penolakan fisik:
  - Status journey dan listing diubah menjadi `CANCELLED`.
  - Wajib menyertakan `cancellationReason` (organoleptic failure).
  - Melepaskan kapasitas mitra (`allocated -= qty`, `available += qty`) sehingga tidak terjadi kuota menggantung.
  - Mencatat aktor, alasan, dan perubahan status di `audit_logs` dan `journey_timeline_events`.
  - **Dilarang keras melakukan reroute otomatis ke `ORGANIC`/kompos** tanpa asesmen ulang yang sah.
