# SantriVora — Catatan untuk Claude Code

## Status proyek
**Production sudah live** di https://santri.voralab.id (dideploy 2026-07-29, `wrangler deploy --env production`). Domain custom + semua binding (D1 `santrivora-db`, KV, R2, ASSETS) sudah tersambung benar di Cloudflare dashboard. Migrasi terbaru (014–018, sync engine offline-first) sudah dikonfirmasi masuk ke D1 production — dicek langsung lewat `PRAGMA table_info` untuk `kegiatan`, `perizinan_pulang`, dan `catatan_haid` (kolom `version`/`is_deleted` ada semua).

Belum ada konfirmasi eksplisit ustadz/staff sudah mulai login & input data harian di produksi — tapi begitu sebuah environment sudah live di domain publik, gak ada cara pasti buat tahu KAPAN persis penggunaan asli mulai terjadi. Jadi workflow di bawah **sudah balik ke mode hati-hati mulai sekarang**, bukan menunggu sinyal itu muncul dulu.

## Workflow git
- **Konfirmasi ke user dulu sebelum**: merge PR ke `main`, atau melakukan perubahan apa pun yang bisa berdampak ke data/schema di D1 production (`santrivora-db`) atau staging.
- Push ke branch kerja sendiri (bukan `main`, belum di-merge) masih boleh langsung — itu belum menyentuh apa pun yang live.
- **Force-push ke `main`/`master` tetap dilarang total, kapan pun** — kalau itu benar-benar diperlukan (misal bersihin git history yang kebocor secret), siapkan langkah-langkahnya secara rinci dan minta user yang menjalankan sendiri command force-push terakhirnya.
- Deploy ke Cloudflare (`wrangler deploy` ke staging/production) **selalu** konfirmasi ke user dulu — ini gak berubah dari awal, cuma makin krusial sekarang karena production beneran live.
- Migrasi DB baru ke staging/production juga wajib konfirmasi dulu — alasan sama: langsung mengubah schema di database yang sudah live.

## Riwayat (konteks historis, bukan aturan aktif lagi)
Sebelum production live, workflow ini sengaja dibikin longgar (push/merge ke `main` boleh langsung tanpa nanya, selama build sukses + tes manual untuk flow kritis) demi mempercepat iterasi selagi belum ada risiko nyata. Itu sudah tidak berlaku lagi sejak baris "Status proyek" di atas — dipertahankan di sini cuma sebagai catatan kenapa histori commit sebelum tanggal ini kelihatan longgar dibanding sekarang.

## Arsitektur singkat
- Backend: Hono di Cloudflare Workers (`src/`), pakai D1 (SQLite) + KV + R2
- Frontend: Vue 3 + Tailwind (`frontend/`), di-build lalu di-serve sebagai static assets dari Worker yang sama (lihat `[assets]` di `wrangler.toml`)
- Auth: JWT access token (15 menit) + refresh token (7 hari), revocation lewat tabel `sessions` (DB) + blacklist di KV
- Migration DB dijalankan manual lewat `npm run db:migrate*` (lihat `package.json`) — belum ada migration runner otomatis, tiap migration baru butuh script baru
- **Migrasi yang rebuild tabel** (pola `CREATE tabel_new → INSERT...SELECT → DROP tabel_lama → RENAME`, dipakai karena SQLite gak bisa `ALTER` constraint): **JANGAN** bungkus dengan `BEGIN TRANSACTION`/`COMMIT` SQL eksplisit — Cloudflare D1 menolak statement itu sama sekali kalau dijalankan lewat `wrangler d1 execute --remote --file=` (error-nya minta pakai `state.storage.transaction()`, API yang cuma bisa diakses dari kode Worker, bukan dari file `.sql`). D1 sudah atomik otomatis untuk satu file/batch yang dieksekusi ("automatic atomic write coalescing"), jadi transaksi eksplisit bukan cuma gak perlu, tapi bikin migrasinya gagal total di baris paling awal (sempat kejadian di `007_kyai_kepala_asrama_pesan.sql` — sudah dikoreksi). `PRAGMA foreign_keys = OFF/ON` tetap dipasang mengapit seluruh blok DDL rebuild-nya (itu bagian yang benar dan tetap perlu, cuma jangan ditambah `BEGIN`/`COMMIT`).
