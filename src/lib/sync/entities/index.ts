import { registerEntity } from '../registry'
import { santriSyncConfig } from './santri'
import { catatanDisiplinSyncConfig } from './catatanDisiplin'
import { absensiSyncConfig } from './absensi'
import { kegiatanSyncConfig } from './kegiatan'
import { jadwalKegiatanSyncConfig } from './jadwalKegiatan'
import { catatanPerkembanganSyncConfig } from './catatanPerkembangan'
import { catatanPersonelSyncConfig } from './catatanPersonel'
import { catatanHaidSyncConfig } from './catatanHaid'
import { kelasSyncConfig } from './kelas'
import { kamarSyncConfig } from './kamar'

registerEntity(santriSyncConfig)
registerEntity(catatanDisiplinSyncConfig)
registerEntity(absensiSyncConfig)
registerEntity(kegiatanSyncConfig)
registerEntity(jadwalKegiatanSyncConfig)
registerEntity(catatanPerkembanganSyncConfig)
registerEntity(catatanPersonelSyncConfig)
registerEntity(catatanHaidSyncConfig)
registerEntity(kelasSyncConfig)
registerEntity(kamarSyncConfig)
