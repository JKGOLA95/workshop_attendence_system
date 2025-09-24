-- database_schema.sql
-- Workshop Attendance Automation Database Schema (Production Ready with TIMESTAMPTZ)

-- Create extension for UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ================== Attendees ==================
CREATE TABLE attendees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    mobile VARCHAR(20) NOT NULL,
    batch VARCHAR(100) NOT NULL,
    qr_code TEXT NOT NULL,                -- Base64 encoded QR code
    qr_data VARCHAR(500) NOT NULL UNIQUE, -- QR string for scanning
    qr_email_status VARCHAR(50),          -- 'sent' or 'failed'
    qr_whatsapp_status VARCHAR(50),       -- 'sent' or 'failed'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================== Attendance ==================
CREATE TABLE attendance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    attendee_id UUID NOT NULL REFERENCES attendees(id) ON DELETE CASCADE,
    entry_time TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(attendee_id) -- one attendance per attendee
);

-- ================== Batches (for reporting only) ==================
CREATE TABLE batches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ,
    max_attendees INTEGER DEFAULT 100,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================== Staff ==================
CREATE TABLE staff (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL, -- bcrypt hash
    role VARCHAR(50) DEFAULT 'staff', -- 'admin', 'staff'
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================== Audit Logs ==================
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    attendee_id UUID REFERENCES attendees(id) ON DELETE SET NULL,
    staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,         -- REGISTER, ENTRY, LOGIN, etc.
    qr_email_status VARCHAR(50),
    qr_whatsapp_status VARCHAR(50),
    qr_last_error TEXT,
    qr_code TEXT,
    qr_data VARCHAR(500),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================== Indexes ==================
CREATE INDEX idx_attendees_email ON attendees(email);
CREATE INDEX idx_attendees_mobile ON attendees(mobile);
CREATE INDEX idx_attendees_batch ON attendees(batch);
CREATE INDEX idx_attendees_qr_data ON attendees(qr_data);
CREATE INDEX idx_attendance_attendee_id ON attendance(attendee_id);
CREATE INDEX idx_attendance_entry_time ON attendance(entry_time);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

-- ================== Auto-update updated_at ==================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_attendees_updated_at 
    BEFORE UPDATE ON attendees 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_staff_updated_at 
    BEFORE UPDATE ON staff 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_audit_logs_updated_at 
    BEFORE UPDATE ON audit_logs 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ================== Views ==================
CREATE VIEW attendance_summary AS
SELECT 
    a.batch AS batch_name,
    COUNT(a.id) AS total_registered,
    COUNT(att.id) AS total_attended,
    ROUND(
        CASE 
            WHEN COUNT(a.id) > 0 THEN (COUNT(att.id)::DECIMAL / COUNT(a.id)) * 100 
            ELSE 0 
        END, 2
    ) AS attendance_percentage
FROM attendees a
LEFT JOIN attendance att ON a.id = att.attendee_id
GROUP BY a.batch;

CREATE VIEW daily_attendance AS
SELECT 
    DATE(att.entry_time) AS attendance_date,
    COUNT(*) AS total_attendees,
    STRING_AGG(DISTINCT a.batch, ', ') AS batches
FROM attendance att
JOIN attendees a ON att.attendee_id = a.id
GROUP BY DATE(att.entry_time)
ORDER BY attendance_date DESC;

-- ================== Seed Data ==================
-- Seed some sample batches
INSERT INTO batches (name, description, start_date, max_attendees) VALUES
('DYP', 'One Day', NOW() + INTERVAL '1 day', 50),
('BMI', 'Four days', NOW() + INTERVAL '1 day', 50),
('THE QUANTUM SHIFT', 'By Kanak sir', NOW() + INTERVAL '1 day', 50),
('BMP', 'Nine months', NOW() + INTERVAL '1 day', 50),
('Alumni', 'All past students', NOW() + INTERVAL '1 day', 50),
('ASMP', 'Five Months', NOW() + INTERVAL '2 days', 30);

-- Seed admin staff (password = "admin123" bcrypt hash)
INSERT INTO staff (name, email, password, role, is_active)
VALUES (
    'Super Admin',
    'admin@workshop.com',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtABWu7Y3BHNY5k9Qr7YM6K2ZE6', -- bcrypt('admin123')
    'admin',
    TRUE
);

-- ================== Permissions ==================
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO workshop_user;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO workshop_user;
