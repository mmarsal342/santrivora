-- Seed data for development

-- Create admin user (default password: Admin123!)
INSERT INTO users (id, email, password_hash, nama_lengkap, role, status)
VALUES (
    'a0000000-0000-0000-0000-000000000001',
    'admin@santrivora.com',
    '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYhwhJHvG7C',
    'Administrator Sistem',
    'admin',
    'approved'
);

-- Create some kelas
INSERT INTO kelas (id, nama, tingkatan, tahun_ajaran) VALUES
    ('k001', 'Kelas 1A', '1', '2025/2026'),
    ('k002', 'Kelas 1B', '1', '2025/2026'),
    ('k003', 'Kelas 2A', '2', '2025/2026'),
    ('k004', 'Kelas 2B', '2', '2025/2026'),
    ('k005', 'Kelas 3A', '3', '2025/2026');

-- Create violation categories
INSERT INTO kategori_pelanggaran (id, nama, deskripsi, urutan_keparahan) VALUES
    ('kp001', 'Ringan', 'Pelanggaran ringan seperti terlambat, tidak memakai seragam', 1),
    ('kp002', 'Sedang', 'Pelanggaran sedang seperti bolos, tidak shalat', 2),
    ('kp003', 'Berat', 'Pelanggaran berat seperti berkelahi, merokok', 3);

-- Settings
INSERT INTO settings (key, value, description) VALUES
    ('tahun_ajaran_aktif', '2025/2026', 'Tahun ajaran yang sedang berjalan'),
    ('nama_pesantren', 'Pesantren SantriVora', 'Nama pesantren'),
    ('max_santri_per_kelas', '30', 'Batas maksimal santri per kelas');