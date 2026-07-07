import api from './api'

export const authService = {
  async register(email: string, password: string, nama_lengkap: string) {
    const response = await api.post('/auth/register', { email, password, nama_lengkap })
    return response.data
  },

  async login(email: string, password: string) {
    const response = await api.post('/auth/login', { email, password })
    return response.data.data
  },

  async logout() {
    const token = localStorage.getItem('access_token')
    const refreshToken = localStorage.getItem('refresh_token')
    await api.post('/auth/logout', { access_token: token, refresh_token: refreshToken })
  },

  async getMe() {
    const response = await api.get('/auth/me')
    return response.data.data
  },

  async changePassword(currentPassword: string, newPassword: string) {
    const response = await api.post('/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword
    })
    return response.data.data
  }
}

export const adminService = {
  async getUsers(status?: string, page = 1, limit = 20) {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) })
    if (status) params.set('status', status)
    const response = await api.get('/admin/users', { params })
    return response.data
  },

  async getUser(id: string) {
    const response = await api.get(`/admin/users/${id}`)
    return response.data.data
  },

  async approveUser(id: string, kelasIds: string[]) {
    const response = await api.post(`/admin/users/${id}/approve`, { kelas_ids: kelasIds })
    return response.data
  },

  async suspendUser(id: string) {
    const response = await api.post(`/admin/users/${id}/suspend`)
    return response.data
  },

  async activateUser(id: string) {
    const response = await api.post(`/admin/users/${id}/activate`)
    return response.data
  },

  async resetPassword(id: string, newPassword: string) {
    const response = await api.post(`/admin/users/${id}/reset-password`, { new_password: newPassword })
    return response.data
  },

  async assignKamar(id: string, kamarIds: string[]) {
    const response = await api.post(`/admin/users/${id}/assign-kamar`, { kamar_ids: kamarIds })
    return response.data
  },

  async getAuditLog(page = 1, limit = 50) {
    const response = await api.get('/admin/audit-log', { params: { page, limit } })
    return response.data
  }
}

export const kamarService = {
  async list() {
    const response = await api.get('/kamar')
    return response.data.data
  },
  async get(id: string) {
    const response = await api.get(`/kamar/${id}`)
    return response.data.data
  },
  async create(data: { nama: string; jenis_kelamin: 'L' | 'P'; kapasitas?: number }) {
    const response = await api.post('/kamar', data)
    return response.data.data
  },
  async update(id: string, data: Record<string, unknown>) {
    const response = await api.put(`/kamar/${id}`, data)
    return response.data.data
  },
  async remove(id: string) {
    await api.delete(`/kamar/${id}`)
  }
}

export const kegiatanService = {
  async list(params?: { tanggal?: string; kelas_id?: string; kamar_id?: string }) {
    const response = await api.get('/kegiatan', { params })
    return response.data.data
  },
  async get(id: string) {
    const response = await api.get(`/kegiatan/${id}`)
    return response.data.data
  },
  async create(data: Record<string, unknown>) {
    const response = await api.post('/kegiatan', data)
    return response.data.data
  },
  async update(id: string, data: Record<string, unknown>) {
    const response = await api.put(`/kegiatan/${id}`, data)
    return response.data.data
  },
  async remove(id: string) {
    await api.delete(`/kegiatan/${id}`)
  }
}

export const absensiService = {
  async bulkMark(payload: { tanggal: string; kegiatan_id?: string; items: Array<{ santri_id: string; status: string; keterangan?: string }> }) {
    const response = await api.post('/absensi/bulk', payload)
    return response.data.data
  },
  async list(params?: Record<string, string | number | undefined>) {
    const response = await api.get('/absensi', { params })
    return response.data
  },
  async rekap(params: { kamar_id?: string; dari: string; sampai: string }) {
    const response = await api.get('/absensi/rekap', { params })
    return response.data.data
  },
  async update(id: string, data: Record<string, unknown>) {
    const response = await api.put(`/absensi/${id}`, data)
    return response.data.data
  }
}

export const catatanHaidService = {
  async list(santriId: string) {
    const response = await api.get('/catatan-haid', { params: { santri_id: santriId } })
    return response.data.data
  },
  async upsert(data: { santri_id: string; tanggal: string; status: 'suci' | 'haid'; catatan?: string }) {
    const response = await api.post('/catatan-haid', data)
    return response.data.data
  },
  async remove(id: string) {
    await api.delete(`/catatan-haid/${id}`)
  }
}

export const kelasService = {
  async list() {
    const response = await api.get('/kelas')
    return response.data.data
  },
  async get(id: string) {
    const response = await api.get(`/kelas/${id}`)
    return response.data.data
  },
  async create(data: { nama: string; tingkatan?: string; tahun_ajaran?: string }) {
    const response = await api.post('/kelas', data)
    return response.data.data
  },
  async update(id: string, data: Record<string, unknown>) {
    const response = await api.put(`/kelas/${id}`, data)
    return response.data.data
  },
  async remove(id: string) {
    await api.delete(`/kelas/${id}`)
  }
}

export const santriService = {
  async list(params?: { kelas_id?: string; jenis_kelamin?: string; status?: string; cursor?: string; limit?: number }) {
    const response = await api.get('/santri', { params })
    return response.data
  },
  async get(id: string) {
    const response = await api.get(`/santri/${id}`)
    return response.data.data
  },
  async create(data: Record<string, unknown>) {
    const response = await api.post('/santri', data)
    return response.data.data
  },
  async update(id: string, data: Record<string, unknown>) {
    const response = await api.put(`/santri/${id}`, data)
    return response.data.data
  },
  async remove(id: string) {
    await api.delete(`/santri/${id}`)
  },
  async bulk(santriList: Array<Record<string, unknown>>) {
    const response = await api.post('/santri/bulk', { santri: santriList })
    return response.data.data
  }
}

export const kategoriService = {
  async list() {
    const response = await api.get('/kategori-pelanggaran')
    return response.data.data
  },
  async create(data: { nama: string; deskripsi?: string; urutan_keparahan?: number }) {
    const response = await api.post('/kategori-pelanggaran', data)
    return response.data.data
  },
  async update(id: string, data: Record<string, unknown>) {
    const response = await api.put(`/kategori-pelanggaran/${id}`, data)
    return response.data.data
  },
  async remove(id: string) {
    await api.delete(`/kategori-pelanggaran/${id}`)
  }
}

export const catatanService = {
  async list(params?: { santri_id?: string; tipe?: string; kelas_id?: string; cursor?: string; limit?: number }) {
    const response = await api.get('/catatan', { params })
    return response.data
  },
  async create(data: Record<string, unknown>) {
    const response = await api.post('/catatan', data)
    return response.data.data
  },
  async update(id: string, data: Record<string, unknown>) {
    const response = await api.put(`/catatan/${id}`, data)
    return response.data.data
  },
  async remove(id: string) {
    await api.delete(`/catatan/${id}`)
  }
}

export const dashboardService = {
  async summary() {
    const response = await api.get('/dashboard/summary')
    return response.data.data
  },
  async trends(period: string = '7d') {
    const response = await api.get('/dashboard/trends', { params: { period } })
    return response.data.data
  },
  async perWaliKamar(params?: { dari?: string; sampai?: string }) {
    const response = await api.get('/dashboard/per-wali-kamar', { params })
    return response.data
  },
  async perWaliKamarSantri(userId: string, params?: { dari?: string; sampai?: string }) {
    const response = await api.get(`/dashboard/per-wali-kamar/${userId}/santri`, { params })
    return response.data
  }
}