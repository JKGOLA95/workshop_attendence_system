
# Workshop Attendance Automation System

A fast, reliable QR-based workshop attendance platform built using FastAPI, React, and PostgreSQL.
Designed for Business Coaching India to automate attendee registration, QR delivery, scanning, and live tracking.


## Key Feature
# Role-Based Access
**Admin**: Manage staff, view audit logs, monitor live stats

**Staff:** Register attendees, upload CSVs, scan QR codes
# Automated Communication
**WhatsApp (WATI API):** Send QR codes + entry passes

**Email (Brevo API):** High-delivery confirmation emails
# Real-Time Tracking
**Server-Sent Events (SSE)** for live attendee updates
Shows QR sent (Email/WhatsApp) + Entry Pass sent status
Search attendee by name or mobile
# Dashboards
Total registrations, attendance %
Batch-wise stats
Live activity feed


## Tech Stack

**Client:** React(vite)

**Server:** Fast(API), PostgresSQL, Railway (API), Vercel (Frontend),WATI (WhatsApp), Brevo (Email),Server-Sent Events (SSE)

## Deployement


## Key Feature
# Role-Based Access
Admin: Manage staff, view audit logs, monitor live stats
Staff: Register attendees, upload CSVs, scan QR codes
# Automated Communication
WhatsApp (WATI API): Send QR codes + entry passes
Email (Brevo API): High-delivery confirmation emails
# Real-Time Tracking
Server-Sent Events (SSE) for live attendee updates
Shows QR sent (Email/WhatsApp) + Entry Pass sent status
Search attendee by name or mobile
# Dashboards
Total registrations, attendance %
Batch-wise stats
Live activity feed


 


## Tech Stack

**Client:** React(vite)

**Server:** Fast(API), PostgresSQL, Railway (API), Vercel (Frontend),WATI (WhatsApp), Brevo (Email),Server-Sent Events (SSE)


## Deployment
**Backend — Railway:**

Async FastAPI app with connection pooling

PostgreSQL cloud instance

Custom domain + SSL via Cloudflare

**Frontend - Vercel:**

Environment var: VITE_API_BASE_URL

Connected to backend’s custom domain

**Database Schema:**

**staff** → admin/staff accounts

**attendees** → registered participants

**attendance** → QR check-in timestamps

**audit_logs** → WhatsApp/Email status logs

**Third Party Integration:**

**WATI API** → WhatsApp automation (QRs & Entry Passes)

**Brevo API** → Email confirmations (100% delivery during tests)




## Running Locally
**Backend:**
uvicorn main:app --reload

**Frontend:**

npm install

npm run dev


