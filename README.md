# REPLATE Backend API

Selamat datang di repositori **REPLATE Backend API**! Repositori ini berisi layanan backend untuk platform **REPLATE** (*Redistribusi Surplus Pangan*), dibangun menggunakan **NestJS**, **TypeScript**, **Prisma ORM**, dan **PostgreSQL**.

---

## 📌 1. Gambaran Singkat: Apa itu REPLATE?

**REPLATE** adalah platform redistribusi surplus pangan yang menghubungkan pemasok/donatur makanan (*hotel, restoran, katering, supermarket*) dengan mitra penerima manfaat (*dapur umum, bank makanan, panti asuhan, lembaga sosial*).

Sistem ini didesain dengan prinsip **keamanan pangan mutlak (Food Safety First)** dan pemulihan logistik yang cepat sebelum makanan kedaluwarsa.

### 🛡️ Fitur & Modul Utama Backend:
1. **Food Safety Gate (FSG) Engine (Deterministik):**
   - Menilai kelayakan fisik, sensoris, suhu penyimpanan, integritas kemasan, dan sisa jendela waktu aman (*safe-until time*).
   - Menghasilkan status mutlak: `PASS`, `REVIEW`, atau `REJECT`. Makanan berstatus `REJECT` atau `REVIEW` tidak akan pernah dialokasikan untuk konsumsi manusia tanpa persetujuan tim QC berwenang.
2. **Rescue Scoring & Routing Engine:**
   - Menghitung skor penyelamatan (*Rescue Score*) berbasis sisa waktu aman, volume makanan, dan ketersediaan mitra.
   - Menentukan jalur pemulihan terbaik: *Direct Redistribution*, *Social Kitchen*, *Authorized Animal Feed*, *Composting*, atau *Safe Disposal*.
3. **Recipient Matching & Atomic Capacity Reservation:**
   - Mencocokkan surplus makanan dengan mitra penerima terdekat berdasarkan kategori makanan yang diterima, fasilitas pendingin (*refrigerator/freezer*), dan kapasitas harian.
   - Reservasi kapasitas dilakukan secara atomik (*ACID transaction*) untuk mencegah pemesanan ganda (*overbooking* / *race condition*).
4. **Logistics & Custody Journey Tracking:**
   - Pelacakan alur distribusi makanan mulai dari *Pending Pickup*, *In Transit*, hingga *Delivered*.
   - Serah terima dilengkapi verifikasi OTP dan pencatatan riwayat suhu pengantaran.
5. **Autentikasi & RBAC (Role-Based Access Control):**
   - Mendukung 3 peran pengguna: `ADMIN`, `SUPPLIER`, dan `MITRA`.
   - Menggunakan JWT (Access & Refresh Token) serta hashing password aman dengan **Argon2**.
6. **Impact Analytics & Audit Trail:**
   - Menghitung dampak sosial-lingkungan: total porsi makanan terselamatkan, kilogram emisi $CO_2$ yang dicegah, dan tingkat keberhasilan penyelamatan.
   - Jejak audit kepatuhan (*audit trail*) untuk setiap perubahan status surplus dan insiden pangan.

---

## 💻 2. Prasyarat Sistem (Prerequisites)

Sebelum menjalankan backend, pastikan perangkat Anda telah terpasang:

| Perangkat Lunak | Versi Minimal / Disarankan | Keterangan |
| :--- | :--- | :--- |
| **Node.js** | `v20.x` LTS *(Disarankan)* atau `v18.x+` | Runtime JavaScript/TypeScript |
| **npm** | `v9.x` atau lebih baru | Paket manajer bawaan Node.js |
| **Docker & Docker Compose** | Versi terbaru | Direkomendasikan untuk menjalankan database PostgreSQL lokal |
| **PostgreSQL** *(Opsional)* | `v16.x` | Jika Anda memilih menjalankan PostgreSQL native tanpa Docker |
| **Git** | Versi terbaru | Version control system |

---

## 🚀 3. Panduan Setup & Menjalankan Project

Ikuti langkah-langkah di bawah ini. Anda dapat memilih tab perintah sesuai sistem operasi yang digunakan (**Linux / macOS** atau **Windows**).

### Langkah 1: Masuk ke Direktori Backend

Pastikan terminal Anda berada di dalam folder `backend/`:

```bash
cd backend
```

---

### Langkah 2: Konfigurasi Environment Variables (`.env`)

Salin berkas contoh konfigurasi `.env.example` menjadi `.env`:

#### 🐧 Di Linux / macOS (Bash / Zsh):
```bash
cp .env.example .env
```

#### 🪟 Di Windows (PowerShell):
```powershell
Copy-Item .env.example .env
```

#### 🪟 Di Windows (Command Prompt / CMD):
```cmd
copy .env.example .env
```

> [!NOTE]
> Konfigurasi default di `.env.example` sudah disesuaikan agar langsung bekerja dengan Docker Compose (`localhost:5432`, user `replate_dev`, password `replate_dev_secret`, database `replate_db`). Untuk lingkungan produksi, gantilah secret JWT dan kredensial database.

---

### Langkah 3: Menjalankan Database PostgreSQL

Cara paling mudah dan bersih adalah menggunakan Docker Compose bawaan:

```bash
docker compose up -d
```

*Perintah di atas akan mengunduh image `postgres:16-alpine`, membuat volume persistent `replate_pg_data`, dan menjalankan database di latar belakang pada port `5432`.*

Untuk memastikan container database berjalan dengan baik:
```bash
docker ps
```
*(Pastikan container `replate-postgres` berstatus `Up`)*.

---

### Langkah 4: Install Dependensi Node.js

Pasang seluruh pustaka dependensi proyek:

```bash
npm install
```

---

### Langkah 5: Inisialisasi Database (Prisma Generate & Migrate)

Jalankan perintah generate Prisma Client dan eksekusi migrasi skema tabel ke PostgreSQL:

```bash
# 1. Generate Prisma Client bindings
npm run prisma:generate

# 2. Jalankan migrasi database
npm run prisma:migrate
```

*Prisma akan menerapkan seluruh migrasi skema dan membuat 12 tabel relasional di PostgreSQL.*

---

### Langkah 6: Seeding Data Awal (Master Data & Demo Accounts)

Jalankan skrip seeder untuk mengisi data master kategori pangan, profil organisasi demo, dan akun uji coba:

```bash
npm run prisma:seed
```

---

### Langkah 7: Menjalankan Server Backend

#### Mode Pengembangan (Development dengan Hot-Reload):
```bash
npm run start:dev
```

Server backend akan berjalan di:
- **API Base URL:** `http://localhost:3000/api/v1`
- **Swagger / OpenAPI Documentation:** `http://localhost:3000/api/docs`
- **Health Check Endpoint:** `http://localhost:3000/api/v1/health`

#### Mode Produksi (Build & Run):
```bash
npm run build
npm run start:prod
```

---

## 🔑 4. Akun Uji Coba Bawaan (Demo Credentials)

Setelah menjalankan `npm run prisma:seed`, sistem menyediakan akun bawaan untuk tiap peran:

| Peran (*Role*) | Email | Password | Nama & Organisasi | Cakupan Akses |
| :--- | :--- | :--- | :--- | :--- |
| **`ADMIN`** | `admin@replate.id` | `admin123` | Siti Administrator<br>*(Pusat Koordinasi REPLATE Jakarta)* | Akses seluruh dashboard, manajemen pengguna & mitra, audit trail, simulasi demo. |
| **`SUPPLIER`** | `supplier@replate.id` | `supplier123` | Budi Chef Executive<br>*(Grand Sahid Catering & Hotel)* | Input listing surplus pangan, pantau hasil Food Safety Gate, pelacakan serah terima. |
| **`MITRA`** | `mitra@replate.id` | `mitra123` | Ahmad Pengelola Dapur<br>*(Dapur Sosial Barokah Matraman)* | Atur kuota kapasitas harian, terima tawaran surplus, konfirmasi penerimaan pangan. |

---

## 📖 5. Panduan Penggunaan API (Usage Guide)

### 1. Eksplorasi Interaktif dengan Swagger UI
Buka browser dan kunjungi:
👉 **[http://localhost:3000/api/docs](http://localhost:3000/api/docs)**

Melalui antarmuka Swagger, Anda dapat langsung mencoba seluruh endpoint, melihat skema DTO, serta melakukan autentikasi via tombol **Authorize** (masukkan token JWT).

### 2. Alur Pengujian Cepat via cURL / HTTP Client

#### A. Verifikasi Status Server (*Health Check*)
```bash
curl -X GET http://localhost:3000/api/v1/health
```
**Respons:**
```json
{
  "status": "ok",
  "service": "replate-backend",
  "timestamp": "2026-10-16T14:50:00.000Z",
  "version": "1.0.0"
}
```

#### B. Melakukan Login (*Authentication*)
```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "supplier@replate.id",
    "password": "supplier123"
  }'
```
**Respons:**
```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "accessToken": "eyJhbGciOi...",
    "user": {
      "id": "10000000-0000-0000-0000-000000000002",
      "email": "supplier@replate.id",
      "fullName": "Budi Chef Executive",
      "role": "SUPPLIER",
      "organizationId": "00000000-0000-0000-0000-000000000002"
    }
  }
}
```

#### C. Mengakses Endpoint Terproteksi
Gunakan `accessToken` yang didapatkan pada header `Authorization`:
```bash
curl -X GET http://localhost:3000/api/v1/auth/me \
  -H "Authorization: Bearer <GANTI_DENGAN_TOKEN_ANDA>"
```

---

## 🗺️ 6. Peta Endpoint Utama API

Semua endpoint diawali dengan prefix `/api/v1`:

| Modul | Method | Endpoint | Peran Akses | Deskripsi |
| :--- | :--- | :--- | :--- | :--- |
| **Auth** | `POST` | `/api/v1/auth/login` | Publik | Otentikasi & perolehan JWT |
| | `POST` | `/api/v1/auth/refresh` | Publik (Cookie) | Perpanjangan Access Token |
| | `GET` | `/api/v1/auth/me` | Authenticated | Mendapatkan profil user yang sedang login |
| | `POST` | `/api/v1/auth/logout` | Authenticated | Mengakhiri sesi pengguna |
| **Surplus** | `POST` | `/api/v1/surplus-listings` | `SUPPLIER` | Membuat penawaran surplus & evaluasi FSG otomatis |
| | `GET` | `/api/v1/surplus-listings` | All Roles | Daftar listing surplus pangan (terfilter per peran) |
| | `GET` | `/api/v1/surplus-listings/:id` | All Roles | Rincian listing, status FSG, dan kalkulasi Rescue Score |
| | `PATCH` | `/api/v1/surplus-listings/:id/cancel`| `SUPPLIER`, `ADMIN` | Membatalkan listing sebelum dijemput |
| **Recipients** | `GET` | `/api/v1/recipients/capacity/me` | `MITRA` | Melihat profil kapasitas harian mitra aktif |
| | `PUT` | `/api/v1/recipients/capacity/me` | `MITRA` | Mengatur batas kuota maksimal penampungan makanan |
| | `GET` | `/api/v1/recipients` | `ADMIN`, `SUPPLIER` | Daftar direktori mitra terverifikasi |
| **Journeys** | `GET` | `/api/v1/journeys/:id` | All Roles | Rincian pelacakan distribusi logistik |
| | `POST` | `/api/v1/journeys/:id/status` | `ADMIN`, `SUPPLIER` | Pembaruan status pengiriman (PICKED_UP, DELIVERED) |
| | `POST` | `/api/v1/journeys/:id/verify-otp` | `MITRA` | Konfirmasi penerimaan menggunakan kode OTP |
| **Analytics** | `GET` | `/api/v1/analytics/impact` | All Roles | Statistik dampak lingkungan & sosial |
| **Admin** | `POST` | `/api/v1/admin/simulation/load-demo` | `ADMIN` | Inisialisasi dataset skenario simulasi lengkap |
| | `DELETE`| `/api/v1/admin/simulation/clear-demo`| `ADMIN` | Menghapus data simulasi demo |
| | `GET` | `/api/v1/admin/audit-logs` | `ADMIN` | Rekam jejak audit keamanan dan log operasional |

---

## 🛠️ 7. Daftar Skrip NPM yang Tersedia

Di dalam folder `backend/`, Anda dapat menjalankan:

| Perintah | Deskripsi |
| :--- | :--- |
| `npm run start:dev` | Menjalankan aplikasi dalam mode development dengan watch/hot-reload |
| `npm run build` | Melakukan kompilasi TypeScript ke folder `dist/` |
| `npm run start:prod` | Menjalankan hasil kompilasi produksi (`dist/main.js`) |
| `npm run prisma:generate` | Memperbarui type definitions Prisma Client berdasarkan `schema.prisma` |
| `npm run prisma:migrate` | Menerapkan migrasi database Prisma ke PostgreSQL lokal |
| `npm run prisma:seed` | Menjalankan script seeding data master dan akun demo |
| `npm test` | Menjalankan rangkaian unit test Jest |
| `npm run test:e2e` | Menjalankan rangkaian end-to-end (E2E) testing |
| `npm run format` | Menjalankan Prettier untuk memformat kode sumber |

---

## 🗂️ 8. Struktur Direktori Backend

```text
backend/
├── prisma/
│   ├── migrations/         # Riwayat berkas migrasi SQL Prisma
│   ├── schema.prisma       # Skema database & definisi relasi tabel
│   └── seed.ts             # Skrip data awal (master data & akun uji coba)
├── src/
│   ├── common/             # Interceptors, filters, decorators, guards bersama
│   ├── config/             # Skema konfigurasi lingkungan & validasi env
│   ├── modules/
│   │   ├── admin/          # Modul operasional admin & dataset simulasi
│   │   ├── analytics/      # Perhitungan metrik dampak lingkungan/sosial
│   │   ├── auth/           # Otentikasi JWT, guards, & strategi Argon2
│   │   ├── engines/        # Pure engines: Food Safety Gate & Rescue Score
│   │   ├── journeys/       # Manajemen status perjalanan & serah terima OTP
│   │   ├── recipients/     # Manajemen profil mitra & kuota kapasitas harian
│   │   └── surplus/        # Pengelolaan listing surplus pangan
│   ├── app.controller.ts   # Endpoint dasar sistem & health check
│   ├── app.module.ts       # Root module NestJS
│   └── main.ts             # Entry point aplikasi & konfigurasi Swagger
├── test/                   # Konfigurasi pengujian E2E
├── docker-compose.yml      # Orkestrasi container PostgreSQL lokal
├── package.json            # Daftar dependensi dan scripts npm
└── README.md               # Dokumentasi panduan penggunaan (berkas ini)
```

---

## 💡 9. Troubleshooting & Catatan Sistem Operasi

### 🪟 Masalah Umum di Windows

1. **Port 5432 Sudah Digunakan (*Port Conflict*):**
   - **Penyebab:** Anda mungkin sudah memiliki PostgreSQL yang berjalan sebagai Windows Service lokal.
   - **Solusi:** Matikan service PostgreSQL lokal lewat *Services (`services.msc`)* dengan menghentikan `postgresql-x64-<versi>`, ATAU ubah `DB_PORT=5433` di berkas `.env` dan `docker-compose.yml`.

2. **PowerShell Script Execution Policy Error:**
   - **Penyebab:** Muncul pesan `cannot be loaded because running scripts is disabled on this system`.
   - **Solusi:** Buka PowerShell sebagai Administrator dan jalankan:
     ```powershell
     Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
     ```

3. **Docker Desktop WSL 2 Belum Berjalan:**
   - **Penyebab:** Perintah `docker compose up -d` gagal menghubungkan ke daemon Docker.
   - **Solusi:** Pastikan aplikasi **Docker Desktop** sudah dibuka dan fitur *WSL 2 backend* aktif di pengaturan Docker Desktop.

4. **Karakter Akhir Baris CRLF vs LF:**
   - **Penyebab:** Git di Windows terkadang mengubah line endings menjadi CRLF sehingga skrip bash dalam container bermasalah.
   - **Solusi:** Konfigurasikan Git untuk mempertahankan line ending LF:
     ```cmd
     git config --global core.autocrlf false
     ```

### 🐧 Masalah Umum di Linux / macOS

1. **Izin Akses Docker (*Permission Denied*):**
   - **Penyebab:** User non-root tidak memiliki akses ke socket docker.
   - **Solusi:** Tambahkan user Anda ke grup docker: `sudo usermod -aG docker $USER` lalu restart terminal/sesi login.

2. **Koneksi Database Gagal saat `npm test`:**
   - **Penyebab:** Pengujian integrasi memerlukan database aktif di latar belakang.
   - **Solusi:** Pastikan container postgres aktif dengan menjalankan `docker compose up -d` sebelum mengeksekusi `npm test`.

---

## 📚 10. Dokumentasi Arsitektur & Spesifikasi Terkait

Untuk pemahaman teknis yang lebih mendalam, silakan merujuk ke dokumen teknis di folder `backend/`:

- 📑 **[`API_SPEC.md`](./API_SPEC.md)**: Kontrak API REST v1 lengkap, format envelope, DTO, dan validasi RFC 7807.
- 🏗️ **[`ARCHITECTURE.md`](./ARCHITECTURE.md)**: Arsitektur arsitektural NestJS, layered pattern, dan diagram alur.
- 🗄️ **[`DATA_MODEL.md`](./DATA_MODEL.md)**: Skema database relasional PostgreSQL, kamus data, dan indeks.
- 🧭 **[`FRONTEND_INTEGRATION.md`](./FRONTEND_INTEGRATION.md)**: Panduan transisi frontend dari mock data ke API live.
- ⚖️ **[`DECISIONS.md`](./DECISIONS.md)**: Catatan keputusan arsitektur (ADR) dan alasan pemilihan teknologi.
- ⚠️ **[`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md)**: Catatan kendala teknis dan rencana perbaikan bertahap.

---

*Dikembangkan dengan ❤️ untuk Ketahanan dan Keadilan Pangan oleh Tim Pengembang REPLATE.*
