-- Seed data for development

-- Create admin user (default password: Admin123!)
INSERT INTO users (id, email, password_hash, nama_lengkap, role, status)
VALUES (
    'a0000000-0000-0000-0000-000000000001',
    'admin@santrivora.com',
    '$2b$12$MWA.AsMIgolRt4oO.WJESu7Yc0Xp26E/S3ohUwLoQDXIEahWyj6D2',
    'Administrator Sistem',
    'admin',
    'approved'
);

-- Create some kelas
INSERT INTO kelas (id, nama, tingkatan, tahun_ajaran) VALUES
    ('11111111-1111-4111-8111-111111111111', 'Kelas 1A', '1', '2025/2026'),
    ('22222222-2222-4222-8222-222222222222', 'Kelas 1B', '1', '2025/2026'),
    ('33333333-3333-4333-8333-333333333333', 'Kelas 2A', '2', '2025/2026'),
    ('44444444-4444-4444-8444-444444444444', 'Kelas 2B', '2', '2025/2026'),
    ('55555555-5555-4555-8555-555555555555', 'Kelas 3A', '3', '2025/2026');

-- Create violation categories
INSERT INTO kategori_pelanggaran (id, nama, deskripsi, urutan_keparahan) VALUES
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Ringan', 'Pelanggaran ringan seperti terlambat, tidak memakai seragam', 1),
    ('bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb', 'Sedang', 'Pelanggaran sedang seperti bolos, tidak shalat', 2),
    ('cccccccc-cccc-4ccc-accc-cccccccccccc', 'Berat', 'Pelanggaran berat seperti berkelahi, merokok', 3);

-- Settings
INSERT INTO settings (key, value, description) VALUES
    ('tahun_ajaran_aktif', '2025/2026', 'Tahun ajaran yang sedang berjalan'),
    ('nama_pesantren', 'Pesantren SantriVora', 'Nama pesantren'),
    ('max_santri_per_kelas', '30', 'Batas maksimal santri per kelas');