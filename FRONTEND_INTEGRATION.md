# REPLATE Frontend Integration & API Migration Guide

Dokumen ini adalah panduan teknis bagi tim frontend untuk menghubungkan aplikasi klien Vite + React ke REPLATE Backend REST API secara bertahap dan terkontrol tanpa mengganggu alur kerja mock data yang sudah ada.

---

## 1. Strategi Transisi Bertahap (*Feature Toggle*)

Frontend mempertahankan mock data dan penyimpanan lokal secara *default*. Untuk mengalihkan permintaan ke backend nyata, gunakan variabel lingkungan Vite:

```bash
# File: frontend/.env (atau .env.local)
VITE_USE_BACKEND_API=true
VITE_API_BASE_URL=http://localhost:3000/api/v1
```

Jika `VITE_USE_BACKEND_API=false` (atau tidak didefinisikan), frontend tetap berjalan 100% menggunakan mock data lokal.

---

## 2. Pemetaan Fungsi Frontend ke REST API Backend

| Fitur / Halaman Frontend | Fungsi Mock Saat Ini | Backend REST API Endpoint | Metode HTTP | Keterangan |
|---|---|---|---|---|
| Login Portal | State lokal / mock credentials | `/api/v1/auth/login` | `POST` | Mengembalikan JWT `accessToken` (15m) & Refresh Token di Cookie HttpOnly |
| User Profile | Local storage user | `/api/v1/auth/me` | `GET` | Memverifikasi sesi aktif dan role pengguna |
| Form Intake Surplus | `foodInventory.js` / form submit | `/api/v1/surplus-listings` | `POST` | Menjalankan Food Safety Gate otomatis & menghitung Rescue Score |
| Riwayat Kiriman Supplier | Mock array listings | `/api/v1/surplus-listings/my-dispatches` | `GET` | Menampilkan kiriman milik organisasi donor yang sedang login |
| Evaluasi Keamanan Pangan | Parameter form lokal | `/api/v1/surplus-listings/:id/assessment` | `GET` | Mengambil audit gate safety: status `PASS`, `REVIEW`, atau `REJECT` |
| Verifikasi Gate Parameter | Update form modal | `/api/v1/surplus-listings/:id/safety-parameters` | `PUT` | Memperbarui parameter penyimpanan untuk re-evaluasi gate |
| Rekomendasi Mitra | `matchingEngine.js` lokal | `/api/v1/surplus-listings/:id/matches` | `GET` | Daftar mitra terurut berdasar skor kecocokan logistik |
| Kapasitas Mitra Penerima | Hardcoded 100 kg | `/api/v1/recipients/my-capacity` | `GET` | Kapasitas harian riil (tersedia, teralokasi, diterima) |
| Tetapkan Mitra Penerima | Local state update | `/api/v1/surplus-listings/:id/assign-destination` | `POST` | Transaksi ACID + Pessimistic Row Lock (`SELECT FOR UPDATE`) |
| Perjalanan Logistik Mitra | Mock deliveries list | `/api/v1/journeys` | `GET` | Filter berdasar status atau organisasi |
| Pelacakan Garis Waktu | Mock timeline array | `/api/v1/journeys/:id` | `GET` | Menampilkan seluruh event timeline dan status transit kurir |
| Update Status Pengiriman | Tombol update lokal | `/api/v1/journeys/:id/advance-status` | `PATCH` | Memajukan status dari `MATCHED` ke `RESCUE_INITIATED` |
| Konfirmasi Penerimaan Fisik | Modal konfirmasi terima | `/api/v1/journeys/:id/confirm-receipt` | `POST` | Mencatat `actualReceivedKg`, mengubah kapasitas teralokasi jadi diterima |
| Penolakan Fisik di Lokasi | Pembatalan / tombol tolak | `/api/v1/journeys/:id/cancel` | `POST` | Membatalkan kiriman (`CANCELLED`), alasan wajib, kapasitas mitra kembali otomatis |
| Rescue Performance Dashboard | `rescueScore.js` aggregator | `/api/v1/analytics/performance` | `GET` | 4 KPI inti terverifikasi, status pipeline, funnel, dampak lingkungan |
| Upstream Prevention Insights | Hardcoded tips | `/api/v1/analytics/insights` | `GET` | Pola surplus berulang dan rekomendasi pencegahan limbah hulu |
| Simulasi Demo Admin | Hardcoded demo reset | `/api/v1/admin/simulation/load-demo` | `POST` | Memuat paket simulasi data demo perkotaan |
| Pembersihan Demo Admin | Clear local storage | `/api/v1/admin/simulation/clear-demo` | `DELETE` | Membersihkan data simulasi tanpa merusak data donasi riil |

---

## 3. Reference Implementation: Client Adapter (`api.js`)

Simpan berkas berikut pada `frontend/src/services/api.js` saat siap mengintegrasikan:

```javascript
/**
 * REPLATE API Client Adapter Layer
 * Mendukung transisi mulus antara mock data lokal dan backend REST API produksi.
 */

const USE_BACKEND_API = import.meta.env.VITE_USE_BACKEND_API === 'true';
const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1';

let authToken = localStorage.getItem('replate_access_token') || null;

export const setAuthToken = (token) => {
  authToken = token;
  if (token) {
    localStorage.setItem('replate_access_token', token);
  } else {
    localStorage.removeItem('replate_access_token');
  }
};

export const getAuthToken = () => authToken;

async function request(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...options.headers,
  };

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers,
    credentials: 'include', // Mengirim HttpOnly cookie untuk refresh token
  });

  // Handle token expired (401)
  if (response.status === 401 && !options._retry && !endpoint.includes('/auth/login')) {
    try {
      const refreshResponse = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (refreshResponse.ok) {
        const refreshData = await refreshResponse.json();
        setAuthToken(refreshData.data.accessToken);
        options._retry = true;
        return request(endpoint, options);
      }
    } catch {
      setAuthToken(null);
    }
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.message || 'Terjadi kesalahan pada permintaan API');
    error.status = response.status;
    error.details = data.details;
    throw error;
  }

  return data.data !== undefined ? data.data : data;
}

// ==========================================
// API Methods Grouped by Domain
// ==========================================

export const api = {
  isLiveApiEnabled: () => USE_BACKEND_API,

  // --- 1. Autentikasi ---
  auth: {
    login: async (email, password) => {
      const data = await request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (data.accessToken) {
        setAuthToken(data.accessToken);
      }
      return data;
    },
    me: () => request('/auth/me'),
    logout: async () => {
      await request('/auth/logout', { method: 'POST' });
      setAuthToken(null);
    },
  },

  // --- 2. Surplus Listings & Food Safety Gate ---
  surplus: {
    create: (listingPayload) =>
      request('/surplus-listings', {
        method: 'POST',
        body: JSON.stringify(listingPayload),
      }),
    getMyDispatches: () => request('/surplus-listings/my-dispatches'),
    getAssessment: (listingId) => request(`/surplus-listings/${listingId}/assessment`),
    updateSafetyParameters: (listingId, parameters) =>
      request(`/surplus-listings/${listingId}/safety-parameters`, {
        method: 'PUT',
        body: JSON.stringify(parameters),
      }),
    getMatches: (listingId) => request(`/surplus-listings/${listingId}/matches`),
    assignDestination: (listingId, recipientId, notes) =>
      request(`/surplus-listings/${listingId}/assign-destination`, {
        method: 'POST',
        body: JSON.stringify({ recipientId, notes }),
      }),
  },

  // --- 3. Recipient Capacities ---
  recipients: {
    getMyCapacity: () => request('/recipients/my-capacity'),
  },

  // --- 4. Rescue Journeys & Doorstep Logistics ---
  journeys: {
    list: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return request(`/journeys${qs ? `?${qs}` : ''}`);
    },
    getById: (journeyId) => request(`/journeys/${journeyId}`),
    advanceStatus: (journeyId, nextStatus, notes) =>
      request(`/journeys/${journeyId}/advance-status`, {
        method: 'PATCH',
        body: JSON.stringify({ nextStatus, notes }),
      }),
    confirmReceipt: (journeyId, actualReceivedKg, notes) =>
      request(`/journeys/${journeyId}/confirm-receipt`, {
        method: 'POST',
        body: JSON.stringify({ actualReceivedKg, notes }),
      }),
    cancel: (journeyId, cancellationReason, isDoorstepRejection = false) =>
      request(`/journeys/${journeyId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ cancellationReason, isDoorstepRejection }),
      }),
  },

  // --- 5. Performance Analytics & Insights ---
  analytics: {
    getPerformance: (lang = 'id') => request(`/analytics/performance?lang=${lang}`),
    getInsights: (lang = 'id') => request(`/analytics/insights?lang=${lang}`),
  },

  // --- 6. Admin & Simulation ---
  admin: {
    loadDemo: () => request('/admin/simulation/load-demo', { method: 'POST' }),
    clearDemo: () => request('/admin/simulation/clear-demo', { method: 'DELETE' }),
  },
};
```

---

## 4. Penanganan Kesalahan Sesuai Standar RFC 7807

Backend REPLATE selalu mengembalikan format kesalahan JSON yang konsisten:

```json
{
  "success": false,
  "statusCode": 409,
  "error": "ConflictException",
  "message": "Kapasitas harian mitra penerima tidak mencukupi untuk alokasi donasi ini",
  "details": {
    "availableCapacityKg": 5.0,
    "requestedKg": 15.0
  },
  "timestamp": "2026-10-15T16:45:00.000Z",
  "path": "/api/v1/surplus-listings/3a7b6c5d.../assign-destination"
}
```

Frontend dapat menampilkan `error.message` secara langsung kepada pengguna atau memeriksa `error.statusCode` untuk penanganan modal spesifik (misal: 409 untuk dialog peringatan kapasitas penuh).
