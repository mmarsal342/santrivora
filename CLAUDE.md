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
- **Migrasi yang rebuild tabel** (pola `CREATE tabel_new → INSERT...SELECT → DROP tabel_lama → RENAME`, dipakai karena SQLite gak bisa `ALTER` constraint): **JANGAN** bungkus dengan `BEGIN TRANSACTION`/`COMMIT` SQL eksplisit — Cloudflare D1 menolak statement itu sama sekali kalau dijalankan lewat `wrangler d1 execute --remote --file=` (error-nya minta pakai `state.storage.transaction()`, API yang cuma bisa diakses dari kode Worker, bukan dari file `.sql`). D1 sudah atomik otomatis untuk satu file/batch yang dieksekusi ("automatic atomic write coalescing"), jadi transaksi eksplisit bukan cuma gak perlu, tapi bikin migrasinya gagal total di baris paling awal (sempat kejadian di `007_kyai_kepala_asrama_pesan.sql` — sudah dikoreksi). `PRAGMA foreign_keys = OFF/ON` tetap dipasang mengapit seluruh blok DDL rebuild-nya (itu bagian yang benar dan tetap perlu, cuma jangan ditambah `BEGIN`/`COMMIT`).
