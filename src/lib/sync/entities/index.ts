import { registerEntity } from '../registry'
import { santriSyncConfig } from './santri'
import { catatanDisiplinSyncConfig } from './catatanDisiplin'
import { absensiSyncConfig } from './absensi'
import { kegiatanSyncConfig } from './kegiatan'
import { jadwalKegiatanSyncConfig } from './jadwalKegiatan'

registerEntity(santriSyncConfig)
registerEntity(catatanDisiplinSyncConfig)
registerEntity(absensiSyncConfig)
registerEntity(kegiatanSyncConfig)
registerEntity(jadwalKegiatanSyncConfig)
