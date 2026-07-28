import { registerEntity } from '../registry'
import { santriSyncConfig } from './santri'
import { catatanDisiplinSyncConfig } from './catatanDisiplin'
import { absensiSyncConfig } from './absensi'

registerEntity(santriSyncConfig)
registerEntity(catatanDisiplinSyncConfig)
registerEntity(absensiSyncConfig)
