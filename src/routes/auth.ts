import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'

export const registerSchema = z.object({
  email: z.string().email('Format email tidak valid').max(255),
  password: z.string()
    .min(8, 'Password minimal 8 karakter')
    .max(128, 'Password maksimal 128 karakter')
    .regex(/[A-Z]/, 'Password harus mengandung huruf kapital')
    .regex(/[a-z]/, 'Password harus mengandung huruf kecil')
    .regex(/\d/, 'Password harus mengandung angka')
    .regex(/[^A-Za-z0-9]/, 'Password harus mengandung karakter spesial'),
  nama_lengkap: z.string().min(2, 'Nama lengkap minimal 2 karakter').max(100)
})

export const loginSchema = z.object({
  email: z.string().email('Format email tidak valid'),
  password: z.string().min(1, 'Password harus diisi')
})

const authRoutes = new Hono()

// POST /api/auth/register
authRoutes.post('/register', zValidator('json', registerSchema), async (c) => {
  return c.json({
    message: 'Endpoint register belum diimplementasi'
  }, 501)
})

// POST /api/auth/login
authRoutes.post('/login', zValidator('json', loginSchema), async (c) => {
  return c.json({
    message: 'Endpoint login belum diimplementasi'
  }, 501)
})

export { authRoutes }