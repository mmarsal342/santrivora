# SantriVora — Catatan untuk Claude Code

## Status proyek
Proyek ini masih tahap pengembangan awal, **belum ada user asli / data production yang dipakai**. Karena itu, workflow git di bawah ini sengaja dibikin longgar untuk mempercepat iterasi.

## Workflow git
- **Push ke branch kerja, dan merge PR ke `main`, boleh dilakukan langsung tanpa nanya konfirmasi ke user dulu** — selama perubahan sudah melalui verifikasi yang wajar (build sukses; tes manual kalau menyentuh flow kritis seperti auth/migration).
- Force-push ke branch kerja sendiri (bukan `main`) juga boleh langsung kalau memang perlu.
- **Pengecualian yang tetap berlaku selalu**: jangan pernah force-push ke `main`/`master` secara langsung. Kalau itu benar-benar diperlukan (misal bersihin git history yang kebocor secret), siapkan langkah-langkahnya secara rinci dan minta user yang menjalankan sendiri command force-push terakhirnya.
- Deploy ke Cloudflare (`wrangler deploy` ke staging/production) tetap konfirmasi ke user dulu sebelum dijalankan — itu langsung berefek ke environment live, beda kelas risiko dari sekadar push/merge kode.

## ⚠️ Kapan aturan longgar ini harus berubah
Begitu aplikasi ini mulai dipakai beneran (ada data santri/user asli, ustadz login & input data harian, dst), **balik ke default hati-hati**: konfirmasi dulu sebelum merge ke `main` atau melakukan perubahan yang berdampak ke data production. Update bagian ini begitu statusnya berubah.

## Arsitektur singkat
- Backend: Hono di Cloudflare Workers (`src/`), pakai D1 (SQLite) + KV + R2
- Frontend: Vue 3 + Tailwind (`frontend/`), di-build lalu di-serve sebagai static assets dari Worker yang sama (lihat `[assets]` di `wrangler.toml`)
- Auth: JWT access token (15 menit) + refresh token (7 hari), revocation lewat tabel `sessions` (DB) + blacklist di KV
- Migration DB dijalankan manual lewat `npm run db:migrate*` (lihat `package.json`) — belum ada migration runner otomatis, tiap migration baru butuh script baru
