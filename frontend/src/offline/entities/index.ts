// Impor tiap entity config di sini (efek samping: registerEntity() jalan saat
// modul ini pertama kali diimpor). Nambah entity baru = 1 file config baru +
// 1 baris import di sini — db.ts membaca registry ini otomatis buat bangun
// schema Dexie, gak ada tempat lain yang perlu disentuh.
import './kamar.config'
import './santri.config'
import './kelas.config'
import './kegiatan.config'
import './jadwalKegiatan.config'
import './kategoriPelanggaran.config'
import './catatanDisiplin.config'
import './absensi.config'
import './catatanHaid.config'
import './catatanPerkembangan.config'
import './perizinanPulang.config'
