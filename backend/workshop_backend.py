# workshop_backend.py — Complete FastAPI Backend (User + Admin flows)
from fastapi import FastAPI, HTTPException, UploadFile, File, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr
from typing import List, Optional

import os
import io
import base64
import uuid
import asyncio
import asyncpg
import pandas as pd
import qrcode
from datetime import datetime
from contextlib import asynccontextmanager
import httpx
import pytz
import bcrypt

from dotenv import load_dotenv

# Load .env file
load_dotenv()

# Access values
DATABASE_URL = os.getenv("DATABASE_URL")
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL")
SEND_CONCURRENCY = int(os.getenv("SEND_CONCURRENCY", "5"))

BREVO_API_KEY = os.getenv("BREVO_API_KEY")
EMAIL_FROM = os.getenv("EMAIL_FROM")
EMAIL_FROM_NAME = os.getenv("EMAIL_FROM_NAME")

WATI_BASE_URL = os.getenv("WATI_BASE_URL")
WATI_API_TOKEN = os.getenv("WATI_API_TOKEN")
WATI_TEMPLATE_NAME_QR = os.getenv("WATI_TEMPLATE_NAME_QR")
WATI_TEMPLATE_NAME_ENTRY = os.getenv("WATI_TEMPLATE_NAME_ENTRY")
WATI_BROADCAST_NAME = os.getenv("WATI_BROADCAST_NAME")
WATI_CHANNEL_NUMBER = os.getenv("WATI_CHANNEL_NUMBER")
WATI_DEFAULT_COUNTRY_CODE = os.getenv("WATI_DEFAULT_COUNTRY_CODE")

SEND_SEMAPHORE = asyncio.BoundedSemaphore(SEND_CONCURRENCY)
IST = pytz.timezone("Asia/Kolkata")

# ===================== MODELS =====================

# User Flow Models
class Attendee(BaseModel):
    name: str
    email: EmailStr
    mobile: str
    batch: str

class BulkAttendee(BaseModel):
    attendees: List[Attendee]

class QRScanResult(BaseModel):
    qr_code: str
    timestamp: Optional[datetime] = None

class StaffLogin(BaseModel):
    email: str
    password: str

# Admin Flow Models
class StaffCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: Optional[str] = "staff"  # role can be 'admin', 'staff', etc.

class StaffUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None

class StaffResponse(BaseModel):
    id: str
    name: str
    email: str
    role: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

# ===================== APP / DB =====================
db_pool = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_pool
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not configured")
    db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=5, max_size=20)
    try:
        yield
    finally:
        await db_pool.close()

app = FastAPI(title="Workshop Attendance API with Admin Management", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ===================== AUTH =====================
security = HTTPBearer()

def verify_token(auth: HTTPAuthorizationCredentials = Depends(security)):
    """Basic token verification - implement proper JWT validation in production"""
    token = auth.credentials
    if not token:
        raise HTTPException(status_code=401, detail="Invalid token")
    return token

async def get_staff_from_token(token: str):
    """Extract staff information from token"""
    try:
        print(f"[AUTH] Parsing token: {token}")
        
        # Parse the token format: bearer-{role}-{staff_id}
        if token.startswith("bearer-"):
            # Split only on first 2 dashes to preserve UUID with dashes
            parts = token.split("-", 2)  # Split into max 3 parts: ['bearer', 'role', 'full-uuid']
            print(f"[AUTH] Token parts: {parts}")
            
            if len(parts) >= 3:
                role = parts[1]
                staff_id = parts[2]  # This is the full UUID including internal dashes
                
                print(f"[AUTH] Extracted role: {role}, staff_id: {staff_id}")
                
                async with db_pool.acquire() as conn:
                    staff = await conn.fetchrow(
                        "SELECT * FROM staff WHERE id=$1 AND is_active=true", 
                        staff_id
                    )
                    if staff and staff["role"] == role:
                        print(f"[AUTH] Staff found: {staff['email']}")
                        return staff
                    else:
                        print(f"[AUTH] Staff not found or role mismatch. Found staff: {bool(staff)}, expected role: {role}")
        
        # Fallback: try to find any admin user for simple tokens containing "admin"
        if "admin" in token.lower():
            print("[AUTH] Using fallback admin lookup")
            async with db_pool.acquire() as conn:
                staff = await conn.fetchrow(
                    "SELECT * FROM staff WHERE role='admin' AND is_active=true LIMIT 1"
                )
                if staff:
                    print(f"[AUTH] Fallback admin found: {staff['email']}")
                    return staff
        
        print("[AUTH] No valid staff found for token")
        return None
    except Exception as e:
        print(f"[AUTH] Token parsing error: {e}")
        return None

async def verify_admin_token(token: str = Depends(verify_token)):
    """Verify that the token belongs to an admin user"""
    try:
        print(f"[AUTH] Verifying admin token: {token[:20]}...")
        
        staff = await get_staff_from_token(token)
        if not staff:
            print("[AUTH] No staff found for token")
            raise HTTPException(status_code=403, detail="Invalid token or user not found")
        
        if staff["role"] != "admin":
            print(f"[AUTH] User {staff['email']} is not admin, role: {staff['role']}")
            raise HTTPException(status_code=403, detail="Admin access required")
        
        print(f"[AUTH] Admin verified: {staff['email']}")
        return staff
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"[AUTH] Admin verification error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Admin verification error: {str(e)}")

# ===================== HELPERS =====================
def _normalize_phone(mobile: str) -> str:
    digits = "".join(ch for ch in (mobile or "") if ch.isdigit())
    if digits.startswith("00"):
        digits = digits[2:]
    if len(digits) == 10 and WATI_DEFAULT_COUNTRY_CODE:
        digits = f"{WATI_DEFAULT_COUNTRY_CODE}{digits}"
    return digits

def _bearer(token: str) -> str:
    t = (token or "").strip()
    return t if t.lower().startswith("bearer ") else f"Bearer {t}"

async def _log_audit(
    action: str,
    attendee_id: Optional[str] = None,
    staff_id: Optional[str] = None,
    qr_code: str = None,
    qr_data: str = None,
    email_status: str = None,
    wa_status: str = None,
    last_error: str = None
):
    """Insert entry into audit_logs. Enhanced to support staff operations."""
    try:
        async with db_pool.acquire() as conn:
            now = datetime.now(IST)
            # Try with both attendee_id and staff_id columns
            try:
                await conn.execute(
                    """INSERT INTO audit_logs
                       (id, attendee_id, staff_id, action, qr_email_status, qr_whatsapp_status, qr_last_error, qr_code, qr_data, created_at, updated_at)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)""",
                    str(uuid.uuid4()), attendee_id, staff_id, action, email_status, wa_status, last_error,
                    qr_code, qr_data, now, now
                )
            except Exception:
                # Fallback to basic schema
                await conn.execute(
                    """INSERT INTO audit_logs
                       (id, action, qr_email_status, qr_whatsapp_status, qr_last_error, qr_code, qr_data, created_at, updated_at)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)""",
                    str(uuid.uuid4()), action, email_status, wa_status, last_error,
                    qr_code, qr_data, now, now
                )
    except Exception as e:
        print("[WARN] audit log insert failed:", e)

# ===================== EMAIL + WATI =====================
async def _send_brevo_email(*, to_email: str, subject: str, text: str, attachments: Optional[List[dict]] = None) -> bool:
    if not BREVO_API_KEY:
        print("[Brevo] missing API key")
        return False
    if not EMAIL_FROM or not EMAIL_FROM_NAME:
        print("[Brevo] missing sender identity")
        return False

    headers = {
        "api-key": BREVO_API_KEY,
        "accept": "application/json",
        "content-type": "application/json",
    }
    payload = {
        "sender": {"email": EMAIL_FROM, "name": EMAIL_FROM_NAME},
        "to": [{"email": to_email}],
        "subject": subject,
        "textContent": text,
    }
    if attachments:
        payload["attachment"] = attachments

    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post("https://api.brevo.com/v3/smtp/email", headers=headers, json=payload)
        print("[Brevo] HTTP:", r.status_code, "body:", r.text[:500])
        r.raise_for_status()
    return True

async def _send_wati_template(*, phone: str, template_name: str, params_obj: List[dict],
                              broadcast_name: Optional[str] = None, channel_number: Optional[str] = None) -> bool:
    if not WATI_API_TOKEN or not WATI_BASE_URL or not template_name:
        print("[WATI] missing base/token/template; skipping")
        return False
    base = WATI_BASE_URL.rstrip("/")
    headers = {"Authorization": _bearer(WATI_API_TOKEN), "Content-Type": "application/json"}
    bname = broadcast_name or WATI_BROADCAST_NAME or "utility"
    chan  = channel_number or WATI_CHANNEL_NUMBER
    try:
        url = f"{base}/api/v2/sendTemplateMessage?whatsappNumber={phone}"
        payload = {"template_name": template_name, "broadcast_name": bname, "parameters": params_obj}
        if chan:
            payload["channel_number"] = chan
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(url, headers=headers, json=payload)
            body_preview = r.text[:500]
            print(f"[WATI] v2 -> {r.status_code} {body_preview}")
            if r.status_code == 200:
                try:
                    j = r.json()
                    if isinstance(j, dict) and j.get("result") is True:
                        return True
                except Exception:
                    pass
    except Exception as e:
        print("[WATI] v2 error:", e)
    return False

# ===================== CORE OPS =====================
async def create_attendee(attendee: Attendee):
    attendee_id = str(uuid.uuid4())
    qr_data = f"WORKSHOP_ATTENDEE:{attendee_id}"

    qr = qrcode.QRCode(version=1, box_size=10, border=5)
    qr.add_data(qr_data)
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    qr_img.save(buf, format="PNG")
    qr_b64 = base64.b64encode(buf.getvalue()).decode()

    now = datetime.now(IST)
    async with db_pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO attendees (id, name, email, mobile, batch, qr_code, qr_data, created_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)""",
            attendee_id, attendee.name, attendee.email, attendee.mobile,
            attendee.batch, qr_b64, qr_data, now
        )
    return {"attendee_id": attendee_id, "qr_code": qr_b64, "qr_data": qr_data}

# ===================== SENDERS =====================
async def send_qr_code(attendee_id: str, attendee: Attendee, qr_code_base64: str) -> bool:
    email_ok, wa_ok, last_err = False, False, None
    async with SEND_SEMAPHORE:
        try:
            attachments = [{"content": qr_code_base64, "name": "qr_code.png"}]
            email_ok = await _send_brevo_email(
                to_email=attendee.email,
                subject=f"Workshop QR Code - {attendee.batch}",
                text=f"Dear {attendee.name},\nYour registration is confirmed.\nBatch: {attendee.batch}\nQR attached.",
                attachments=attachments
            )
        except Exception as e:
            last_err = f"Brevo error: {e}"

        try:
            phone = _normalize_phone(attendee.mobile)
            if phone and WATI_TEMPLATE_NAME_QR:
                qr_url = f"{PUBLIC_BASE_URL}/api/qr/{attendee_id}.png" if PUBLIC_BASE_URL else ""
                params_obj = [
                    {"name": "name", "value": attendee.name},
                    {"name": "batch", "value": attendee.batch},
                    {"name": "qr_code", "value": qr_url},
                ]
                wa_ok = await _send_wati_template(
                    phone=phone, template_name=WATI_TEMPLATE_NAME_QR,
                    params_obj=params_obj, broadcast_name=WATI_BROADCAST_NAME
                )
                if not wa_ok:
                    last_err = "WATI QR send failed"
        except Exception as e:
            last_err = f"WATI error: {e}"

    email_status = "sent" if email_ok else "failed"
    wa_status = "sent" if wa_ok else "failed"
    await _log_audit(
        action="REGISTER",
        attendee_id=attendee_id,
        qr_code=qr_code_base64,
        qr_data=f"WORKSHOP_ATTENDEE:{attendee_id}",
        email_status=email_status,
        wa_status=wa_status,
        last_error=last_err
    )
    return email_ok and wa_ok

async def send_entry_pass(att_row, entry_time: datetime) -> bool:
    """Sends ENTRY confirmation (typically WhatsApp template) post successful scan."""
    if not att_row:
        return False

    email_ok, wa_ok, last_err = False, False, None
    attendee_name = att_row.get("name") if isinstance(att_row, dict) else att_row["name"]
    attendee_batch = att_row.get("batch") if isinstance(att_row, dict) else att_row["batch"]
    attendee_email = att_row.get("email") if isinstance(att_row, dict) else att_row["email"]
    attendee_mobile = att_row.get("mobile") if isinstance(att_row, dict) else att_row["mobile"]

    try:
        email_ok = await _send_brevo_email(
            to_email=attendee_email,
            subject=f"Entry Confirmed - {attendee_batch}",
            text=f"Dear {attendee_name},\nYour entry at {entry_time.astimezone(IST).strftime('%d-%b-%Y %I:%M %p IST')} is confirmed.\nEnjoy the workshop!"
        )
    except Exception as e:
        last_err = f"Brevo entry email error: {e}"

    try:
        phone = _normalize_phone(attendee_mobile)
        if phone and WATI_TEMPLATE_NAME_ENTRY:
            params_obj = [
                {"name": "name", "value": attendee_name},
                {"name": "batch", "value": attendee_batch},
                {"name": "time", "value": entry_time.astimezone(IST).strftime('%d-%b-%Y %I:%M %p')},
                {"name": "email", "value": attendee_email},
              ]

            wa_ok = await _send_wati_template(
                phone=phone,
                template_name=WATI_TEMPLATE_NAME_ENTRY,
                params_obj=params_obj,
                broadcast_name=WATI_BROADCAST_NAME
            )
            if not wa_ok:
                last_err = "WATI entry send failed"
    except Exception as e:
        last_err = f"WATI entry error: {e}"

    await _log_audit(
        action="ENTRY",
        attendee_id=(att_row.get("id") if isinstance(att_row, dict) else att_row["id"]),
        email_status=("sent" if email_ok else "failed"),
        wa_status=("sent" if wa_ok else "failed"),
        last_error=last_err
    )
    return email_ok or wa_ok

# ===================== USER FLOW APIs =====================

@app.post("/api/staff/login")
async def staff_login(body: StaffLogin):
    """Enhanced staff login with account status check"""
    try:
        async with db_pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM staff WHERE email=$1 AND is_active=true", 
                body.email
            )
            if not row:
                await _log_audit(
                    action="LOGIN_FAILED",
                    qr_data=f"EMAIL:{body.email}",
                    last_error="Invalid credentials or inactive account"
                )
                raise HTTPException(status_code=401, detail="Invalid credentials")
            
            stored_hash = row["password"]
            
            # Handle both hashed and plain-text passwords for migration
            password_valid = False
            if stored_hash.startswith("$2b$"):
                # Bcrypt hash
                if isinstance(stored_hash, str):
                    stored_hash = stored_hash.encode()
                password_valid = bcrypt.checkpw(body.password.encode(), stored_hash)
            else:
                # Plain text password - hash it and update
                if stored_hash == body.password:
                    password_valid = True
                    new_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
                    await conn.execute(
                        "UPDATE staff SET password=$1 WHERE id=$2",
                        new_hash, row["id"]
                    )
                    print(f"[AUTH] Migrated plain password to hash for {body.email}")
            
            if not password_valid:
                await _log_audit(
                    action="LOGIN_FAILED",
                    staff_id=str(row["id"]),
                    qr_data=f"EMAIL:{body.email}",
                    last_error="Invalid password"
                )
                raise HTTPException(status_code=401, detail="Invalid credentials")
            
            # Update last login time
            now = datetime.now(IST)
            await conn.execute(
                "UPDATE staff SET updated_at=$1 WHERE id=$2",
                now, row["id"]
            )
            
            # Log successful login
            await _log_audit(
                action="LOGIN_SUCCESS",
                staff_id=str(row["id"]),
                qr_data=f"STAFF_LOGIN:{row['id']}",
                last_error=None
            )
            
            # Return consistent token format
            token = f"bearer-{row['role']}-{row['id']}"
            print(f"[AUTH] Login successful for {body.email}, token: {token}")
            
            return {
                "message": "Login successful", 
                "staff_id": str(row["id"]), 
                "email": row["email"],
                "name": row["name"],
                "role": row["role"],
                "token": token
            }
            
    except HTTPException:
        raise
    except Exception as e:
        print(f"[AUTH] Login error: {str(e)}")
        await _log_audit(
            action="LOGIN_ERROR",
            qr_data=f"EMAIL:{body.email}",
            last_error=f"Login system error: {str(e)}"
        )
        raise HTTPException(status_code=500, detail=f"Login error: {str(e)}")


@app.post("/api/register/bulk")
async def bulk_register(body: BulkAttendee, token: str = Depends(verify_token)):
    created = []
    for a in body.attendees:
        res = await create_attendee(a)
        created.append((a, res["attendee_id"], res["qr_code"]))
    
    await asyncio.gather(*(send_qr_code(aid, a, qr) for (a, aid, qr) in created))

    data = [{"name": a.name, "email": a.email, "mobile": a.mobile, "batch": a.batch,
             "attendee_id": aid, "qr_code": qr} for (a, aid, qr) in created]
    return {"message": f"Successfully registered {len(created)} attendees", "data": data}

@app.post("/api/register/single")
async def single_register(attendee: Attendee, token: str = Depends(verify_token)):
    res = await create_attendee(attendee)
    await send_qr_code(res["attendee_id"], attendee, res["qr_code"])
    return {"message": "Attendee registered successfully", "attendee_id": res["attendee_id"],
            "qr_code": res["qr_code"], "name": attendee.name, "email": attendee.email, "batch": attendee.batch}

@app.post("/api/scan")
async def scan_qr(scan_data: QRScanResult, token: str = Depends(verify_token)):
    try:
        async with db_pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM attendees WHERE qr_data=$1", scan_data.qr_code)
            if not row:
                raise HTTPException(status_code=404, detail="Invalid QR code")

            existing = await conn.fetchrow("SELECT * FROM attendance WHERE attendee_id=$1", row["id"])
            if existing:
                return {"message": "Attendance already marked",
                        "attendee": {"name": row["name"], "batch": row["batch"], "entry_time": existing["entry_time"]}}

            entry_time = datetime.now(IST)
            await conn.execute(
                "INSERT INTO attendance (attendee_id, entry_time, created_at) VALUES ($1,$2,$3)",
                row["id"], entry_time, entry_time
            )

        await send_entry_pass(row, entry_time)
        return {"message": "Attendance marked successfully",
                "attendee": {"name": row["name"], "email": row["email"], "mobile": row["mobile"],
                             "batch": row["batch"], "entry_time": entry_time}}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing QR scan: {str(e)}")

@app.get("/api/attendance/dashboard")
async def get_attendance_dashboard(token: str = Depends(verify_token)):
    async with db_pool.acquire() as conn:
        total = await conn.fetchval("SELECT COUNT(*) FROM attendees")
        attended = await conn.fetchval("SELECT COUNT(*) FROM attendance")
        batch_rows = await conn.fetch(
            """SELECT a.batch,
                      COUNT(a.id) AS total_registered,
                      COUNT(att.id) AS total_attended
               FROM attendees a
               LEFT JOIN attendance att ON a.id=att.attendee_id
               GROUP BY a.batch"""
        )
    return {
        "total_attendees": total,
        "marked_attendance": attended,
        "attendance_rate": round((attended/total)*100, 2) if total > 0 else 0,
        "batch_wise_data": [dict(r) for r in batch_rows]
    }

@app.post("/api/upload/csv")
async def upload_csv(file: UploadFile = File(...), token: str = Depends(verify_token)):
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are allowed")
    try:
        content = await file.read()
        s = content.decode("utf-8-sig")
        df = pd.read_csv(io.StringIO(s))
        df.columns = [c.strip().lower() for c in df.columns]

        required = ["name", "email", "mobile", "batch"]
        if df.columns.tolist() != required:
            raise HTTPException(
                status_code=400,
                detail=f"CSV must contain exact columns: {required}, got {df.columns.tolist()}"
            )

        attendees = [
            Attendee(
                name=str(r["name"]).strip(),
                email=str(r["email"]).strip(),
                mobile=str(r["mobile"]).strip(),
                batch=str(r["batch"]).strip()
            )
            for _, r in df.iterrows()
        ]

        created = []
        for a in attendees:
            res = await create_attendee(a)
            created.append((a, res["attendee_id"], res["qr_code"]))

        await asyncio.gather(*(send_qr_code(aid, a, qr) for (a, aid, qr) in created))
        return {"message": f"Successfully processed {len(created)} attendees from CSV",
                "total_processed": len(created)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing CSV: {str(e)}")

@app.get("/api/qr/{attendee_id}.png")
async def get_qr_png(attendee_id: str):
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("SELECT qr_code FROM attendees WHERE id=$1", attendee_id)
        if not row:
            raise HTTPException(status_code=404, detail="QR not found")
        png_bytes = base64.b64decode(row["qr_code"])
        return StreamingResponse(io.BytesIO(png_bytes), media_type="image/png")

@app.post("/api/resend/pending")
async def resend_pending(limit: int = 200, token: str = Depends(verify_token)):
    async with db_pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT id,name,email,mobile,batch,qr_code
               FROM attendees
               WHERE (COALESCE(qr_email_status,'')<>'sent' OR COALESCE(qr_whatsapp_status,'')<>'sent')
               ORDER BY created_at
               LIMIT $1""",
            limit
        )
    results = await asyncio.gather(
        *(send_qr_code(r["id"],
                       Attendee(name=r["name"], email=r["email"], mobile=r["mobile"], batch=r["batch"]),
                       r["qr_code"]) for r in rows),
        return_exceptions=True
    )
    ok = sum(1 for r in results if r is True)
    return {"retried": len(rows), "success": ok, "failed": len(rows)-ok}

# ===================== ADMIN FLOW APIs =====================

@app.post("/api/admin/staff", response_model=StaffResponse)
async def create_staff_member(
    staff_data: StaffCreate, 
    admin_user = Depends(verify_admin_token)
):
    """Create a new staff member (Admin only)"""
    print(f"[ADMIN] Creating staff member: {staff_data.email}")
    try:
        staff_id = str(uuid.uuid4())
        now = datetime.now(IST)
        
        password_hash = bcrypt.hashpw(staff_data.password.encode(), bcrypt.gensalt())
        
        async with db_pool.acquire() as conn:
            existing = await conn.fetchrow("SELECT id FROM staff WHERE email=$1", staff_data.email)
            if existing:
                print(f"[ADMIN] Email {staff_data.email} already exists")
                raise HTTPException(status_code=409, detail="Email already exists")
            
            await conn.execute(
                """INSERT INTO staff (id, name, email, password, role, is_active, created_at, updated_at)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8)""",
                staff_id, staff_data.name, staff_data.email, password_hash.decode(),
                staff_data.role, True, now, now
            )
            
            new_staff = await conn.fetchrow("SELECT * FROM staff WHERE id=$1", staff_id)
            print(f"[ADMIN] Staff created successfully: {new_staff['email']}")
            
        await _log_audit(
            action="STAFF_CREATE",
            staff_id=staff_id,
            qr_data=f"STAFF_CREATED:{staff_id}",
            last_error=None
        )
        
        return StaffResponse(
            id=str(new_staff["id"]),  # Convert UUID to string
            name=new_staff["name"],
            email=new_staff["email"],
            role=new_staff["role"],
            is_active=new_staff["is_active"],
            created_at=new_staff["created_at"],
            updated_at=new_staff["updated_at"]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ADMIN] Error creating staff: {str(e)}")
        await _log_audit(
            action="STAFF_CREATE",
            last_error=f"Failed to create staff: {str(e)}"
        )
        raise HTTPException(status_code=500, detail=f"Error creating staff member: {str(e)}")

@app.get("/api/admin/staff", response_model=List[StaffResponse])
async def list_staff_members(
    include_inactive: bool = False,
    admin_user = Depends(verify_admin_token)
):
    """List all staff members (Admin only)"""
    print("[ADMIN] Loading staff list")
    try:
        async with db_pool.acquire() as conn:
            if include_inactive:
                rows = await conn.fetch("SELECT * FROM staff ORDER BY created_at DESC")
            else:
                rows = await conn.fetch(
                    "SELECT * FROM staff WHERE is_active=true ORDER BY created_at DESC"
                )
            
        print(f"[ADMIN] Found {len(rows)} staff members")
        
        return [
            StaffResponse(
                id=str(row["id"]),  # Convert UUID to string
                name=row["name"],
                email=row["email"],
                role=row["role"],
                is_active=row["is_active"],
                created_at=row["created_at"],
                updated_at=row["updated_at"]
            )
            for row in rows
        ]
        
    except Exception as e:
        print(f"[ADMIN] Error fetching staff list: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error fetching staff members: {str(e)}")

@app.put("/api/admin/staff/{staff_id}", response_model=StaffResponse)
async def update_staff_member(
    staff_id: str,
    staff_update: StaffUpdate,
    admin_user = Depends(verify_admin_token)
):
    """Update a staff member (Admin only)"""
    print(f"[ADMIN] Updating staff member: {staff_id}")
    try:
        async with db_pool.acquire() as conn:
            existing = await conn.fetchrow("SELECT * FROM staff WHERE id=$1", staff_id)
            if not existing:
                raise HTTPException(status_code=404, detail="Staff member not found")
            
            update_fields = []
            update_values = []
            param_count = 1
            
            if staff_update.name is not None:
                update_fields.append(f"name=${param_count}")
                update_values.append(staff_update.name)
                param_count += 1
                
            if staff_update.email is not None:
                email_check = await conn.fetchrow(
                    "SELECT id FROM staff WHERE email=$1 AND id!=$2", 
                    staff_update.email, staff_id
                )
                if email_check:
                    raise HTTPException(status_code=409, detail="Email already exists")
                    
                update_fields.append(f"email=${param_count}")
                update_values.append(staff_update.email)
                param_count += 1
                
            if staff_update.password is not None:
                password_hash = bcrypt.hashpw(staff_update.password.encode(), bcrypt.gensalt())
                update_fields.append(f"password=${param_count}")
                update_values.append(password_hash.decode())
                param_count += 1
                
            if staff_update.role is not None:
                update_fields.append(f"role=${param_count}")
                update_values.append(staff_update.role)
                param_count += 1
                
            if staff_update.is_active is not None:
                update_fields.append(f"is_active=${param_count}")
                update_values.append(staff_update.is_active)
                param_count += 1
                
            if not update_fields:
                raise HTTPException(status_code=400, detail="No fields to update")
            
            # Add updated_at
            now = datetime.now(IST)
            update_fields.append(f"updated_at=${param_count}")
            update_values.append(now)
            param_count += 1
            
            # Add staff_id for WHERE clause
            update_values.append(staff_id)
            
            # Execute update
            query = f"UPDATE staff SET {', '.join(update_fields)} WHERE id=${param_count}"
            await conn.execute(query, *update_values)
            
            # Fetch updated record
            updated_staff = await conn.fetchrow("SELECT * FROM staff WHERE id=$1", staff_id)
            
        # Log audit trail
        await _log_audit(
            action="STAFF_UPDATE",
            staff_id=staff_id,
            qr_data=f"STAFF_UPDATED:{staff_id}",
            last_error=None
        )
        
        return StaffResponse(
            id=str(updated_staff["id"]),  # Convert UUID to string
            name=updated_staff["name"],
            email=updated_staff["email"],
            role=updated_staff["role"],
            is_active=updated_staff["is_active"],
            created_at=updated_staff["created_at"],
            updated_at=updated_staff["updated_at"]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        await _log_audit(
            action="STAFF_UPDATE",
            staff_id=staff_id,
            last_error=f"Failed to update staff {staff_id}: {str(e)}"
        )
        raise HTTPException(status_code=500, detail=f"Error updating staff member: {str(e)}")

@app.delete("/api/admin/staff/{staff_id}")
async def delete_staff_member(
    staff_id: str,
    permanent: bool = False,
    admin_user = Depends(verify_admin_token)
):
    """Delete or deactivate a staff member (Admin only)"""
    print(f"[ADMIN] Deleting staff member: {staff_id}")
    try:
        async with db_pool.acquire() as conn:
            existing = await conn.fetchrow("SELECT * FROM staff WHERE id=$1", staff_id)
            if not existing:
                raise HTTPException(status_code=404, detail="Staff member not found")
            
            # Prevent admin from deleting themselves
            if existing["email"] == admin_user["email"]:
                raise HTTPException(status_code=400, detail="Cannot delete your own account")
            
            now = datetime.now(IST)
            
            if permanent:
                await conn.execute("DELETE FROM staff WHERE id=$1", staff_id)
                action = "STAFF_DELETE_PERMANENT"
                message = "Staff member permanently deleted"
            else:
                await conn.execute(
                    "UPDATE staff SET is_active=false, updated_at=$1 WHERE id=$2",
                    now, staff_id
                )
                action = "STAFF_DELETE_SOFT"
                message = "Staff member deactivated"
        
        await _log_audit(
            action=action,
            staff_id=staff_id,
            qr_data=f"STAFF_DELETED:{staff_id}",
            last_error=None
        )
        
        return {"message": message, "staff_id": staff_id}
        
    except HTTPException:
        raise
    except Exception as e:
        await _log_audit(
            action="STAFF_DELETE",
            staff_id=staff_id,
            last_error=f"Failed to delete staff {staff_id}: {str(e)}"
        )
        raise HTTPException(status_code=500, detail=f"Error deleting staff member: {str(e)}")

@app.get("/api/admin/staff/{staff_id}", response_model=StaffResponse)
async def get_staff_member(
    staff_id: str,
    admin_user = Depends(verify_admin_token)
):
    """Get a specific staff member (Admin only)"""
    try:
        async with db_pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM staff WHERE id=$1", staff_id)
            if not row:
                raise HTTPException(status_code=404, detail="Staff member not found")
            
        return StaffResponse(
            id=str(row["id"]),  # Convert UUID to string
            name=row["name"],
            email=row["email"],
            role=row["role"],
            is_active=row["is_active"],
            created_at=row["created_at"],
            updated_at=row["updated_at"]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching staff member: {str(e)}")

@app.get("/api/admin/dashboard")
async def get_admin_dashboard(admin_user = Depends(verify_admin_token)):
    """Get admin dashboard with comprehensive statistics"""
    print("[ADMIN] Loading admin dashboard")
    try:
        async with db_pool.acquire() as conn:
            # Staff statistics
            total_staff = await conn.fetchval("SELECT COUNT(*) FROM staff")
            active_staff = await conn.fetchval("SELECT COUNT(*) FROM staff WHERE is_active=true")
            admin_count = await conn.fetchval("SELECT COUNT(*) FROM staff WHERE role='admin' AND is_active=true")
            
            # Attendee statistics
            total_attendees = await conn.fetchval("SELECT COUNT(*) FROM attendees")
            total_attendance = await conn.fetchval("SELECT COUNT(*) FROM attendance")
            
            # Recent activities from audit logs
            recent_activities = await conn.fetch(
                """SELECT action, created_at, qr_data, qr_last_error
                   FROM audit_logs 
                   ORDER BY created_at DESC 
                   LIMIT 10"""
            )
            
            # Batch-wise statistics
            batch_stats = await conn.fetch(
                """SELECT a.batch,
                          COUNT(a.id) AS registered,
                          COUNT(att.id) AS attended,
                          ROUND((COUNT(att.id)::numeric / NULLIF(COUNT(a.id), 0)) * 100, 2) AS attendance_rate
                   FROM attendees a
                   LEFT JOIN attendance att ON a.id = att.attendee_id
                   GROUP BY a.batch
                   ORDER BY registered DESC"""
            )
            
            # Email/WhatsApp delivery statistics
            email_stats = await conn.fetch(
                """SELECT 
                       COUNT(CASE WHEN qr_email_status = 'sent' THEN 1 END) as email_sent,
                       COUNT(CASE WHEN qr_email_status = 'failed' THEN 1 END) as email_failed,
                       COUNT(CASE WHEN qr_whatsapp_status = 'sent' THEN 1 END) as wa_sent,
                       COUNT(CASE WHEN qr_whatsapp_status = 'failed' THEN 1 END) as wa_failed
                   FROM audit_logs 
                   WHERE action IN ('REGISTER', 'ENTRY')"""
            )
            
        return {
            "staff_stats": {
                "total_staff": total_staff,
                "active_staff": active_staff,
                "admin_count": admin_count,
                "inactive_staff": total_staff - active_staff
            },
            "attendee_stats": {
                "total_registered": total_attendees,
                "total_attended": total_attendance,
                "attendance_rate": round((total_attendance/total_attendees)*100, 2) if total_attendees > 0 else 0,
                "pending_attendance": total_attendees - total_attendance
            },
            "communication_stats": {
                "email_sent": email_stats[0]["email_sent"] if email_stats else 0,
                "email_failed": email_stats[0]["email_failed"] if email_stats else 0,
                "whatsapp_sent": email_stats[0]["wa_sent"] if email_stats else 0,
                "whatsapp_failed": email_stats[0]["wa_failed"] if email_stats else 0
            },
            "batch_statistics": [dict(row) for row in batch_stats],
            "recent_activities": [
                {
                    "action": row["action"],
                    "timestamp": row["created_at"],
                    "details": row["qr_data"],
                    "error": row["qr_last_error"]
                }
                for row in recent_activities
            ]
        }
        
    except Exception as e:
        print(f"[ADMIN] Error fetching admin dashboard: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error fetching admin dashboard: {str(e)}")

@app.get("/api/admin/audit-logs")
async def get_audit_logs(
    limit: int = 100,
    action_filter: Optional[str] = None,
    admin_user = Depends(verify_admin_token)
):
    """Get audit logs with optional filtering (Admin only)"""
    try:
        async with db_pool.acquire() as conn:
            if action_filter:
                rows = await conn.fetch(
                    """SELECT * FROM audit_logs 
                       WHERE action ILIKE $1 
                       ORDER BY created_at DESC 
                       LIMIT $2""",
                    f"%{action_filter}%", limit
                )
            else:
                rows = await conn.fetch(
                    """SELECT * FROM audit_logs 
                       ORDER BY created_at DESC 
                       LIMIT $1""",
                    limit
                )
            
        return {
            "logs": [dict(row) for row in rows],
            "total_returned": len(rows)
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching audit logs: {str(e)}")

# ===================== HEALTH & UTILITY =====================

@app.get("/api/health")
async def health():
    """Health check endpoint"""
    try:
        # Test database connection
        async with db_pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        
        return {
            "status": "healthy",
            "timestamp": datetime.now(IST).isoformat(),
            "database": "connected",
            "services": {
                "brevo_email": "configured" if BREVO_API_KEY else "not_configured",
                "wati_whatsapp": "configured" if WATI_API_TOKEN else "not_configured"
            }
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Service unhealthy: {str(e)}")

@app.get("/api/config")
async def get_config(admin_user = Depends(verify_admin_token)):
    """Get system configuration (Admin only)"""
    return {
        "database_connected": bool(db_pool),
        "public_base_url": PUBLIC_BASE_URL,
        "send_concurrency": SEND_CONCURRENCY,
        "email_configured": bool(BREVO_API_KEY and EMAIL_FROM),
        "whatsapp_configured": bool(WATI_API_TOKEN and WATI_BASE_URL),
        "templates": {
            "qr_template": WATI_TEMPLATE_NAME_QR,
            "entry_template": WATI_TEMPLATE_NAME_ENTRY,
            "broadcast_name": WATI_BROADCAST_NAME
        }
    }

# ===================== MAIN =====================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)