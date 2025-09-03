# workshop_backend.py — FastAPI Backend (Brevo email + WATI WhatsApp + status + concurrency + retry)
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

from dotenv import load_dotenv
import os

# Load .env file
load_dotenv()

# Access values
DATABASE_URL = os.getenv("DATABASE_URL")
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL")
SEND_CONCURRENCY = int(os.getenv("SEND_CONCURRENCY"))

BREVO_API_KEY = os.getenv("BREVO_API_KEY")
EMAIL_FROM = os.getenv("EMAIL_FROM")
EMAIL_FROM_NAME = os.getenv("EMAIL_FROM_NAME")

WATI_BASE_URL = os.getenv("WATI_BASE_URL")
WATI_API_TOKEN  = os.getenv("WATI_API_TOKEN") 
WATI_TEMPLATE_NAME_QR  = os.getenv("WATI_TEMPLATE_NAME_QR")
WATI_TEMPLATE_NAME_ENTRY  = os.getenv("WATI_TEMPLATE_NAME_ENTRY")
WATI_BROADCAST_NAME       = os.getenv("WATI_BROADCAST_NAME")
WATI_CHANNEL_NUMBER       = os.getenv("WATI_CHANNEL_NUMBER")
WATI_DEFAULT_COUNTRY_CODE = os.getenv("WATI_DEFAULT_COUNTRY_CODE")
SEND_SEMAPHORE = asyncio.BoundedSemaphore(SEND_CONCURRENCY)
'''
# ===================== SETTINGS =====================
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:41421041.exe@127.0.0.1:5432/workshop_db")

# Public base URL of THIS backend so recipients can open the QR image link in WhatsApp/email
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://localhost:8000")

# Concurrency cap so providers aren't throttled
SEND_CONCURRENCY = int(os.getenv("SEND_CONCURRENCY", "10"))

# --- Brevo (Sendinblue) for email ---
BREVO_API_KEY   = os.getenv("BREVO_API_KEY", "REMOVED")  # set your xkeysib-... key
EMAIL_FROM      = os.getenv("EMAIL_FROM", "pankaj@bcoachindia.com")  # must be verified sender/domain in Brevo
EMAIL_FROM_NAME = os.getenv("EMAIL_FROM_NAME", "Workshop Team")

# --- WATI for WhatsApp ---
# IMPORTANT: Base must be ONLY the tenant host, e.g. "https://live-mt-server.wati.io/424907" (no trailing /api here)
WATI_BASE_URL             = os.getenv("WATI_BASE_URL", "https://live-mt-server.wati.io/424907").rstrip("/")
# We accept either WATI_API_TOKEN or WATI_API_KEY
WATI_API_TOKEN            = (os.getenv("WATI_API_TOKEN") or os.getenv("WATI_API_KEY") or "REMOVED").strip()
# Your approved template names
WATI_TEMPLATE_NAME_QR     = os.getenv("WATI_TEMPLATE_NAME_QR", os.getenv("WATI_TEMPLATE_NAME", "your_qr_code"))
WATI_TEMPLATE_NAME_ENTRY  = os.getenv("WATI_TEMPLATE_NAME_ENTRY", "your_entry_pass")
# The broadcast name you use in WATI UI (support suggested "utility")
WATI_BROADCAST_NAME       = os.getenv("WATI_BROADCAST_NAME", "utility")
# Your sender / channel number as WATI expects (e.g., 918882918484)
WATI_CHANNEL_NUMBER       = os.getenv("WATI_CHANNEL_NUMBER", "918882918484")
# Default country code to auto-prefix 10-digit numbers
WATI_DEFAULT_COUNTRY_CODE = os.getenv("WATI_DEFAULT_COUNTRY_CODE", "91")

# One global async semaphore for all outbound sends
SEND_SEMAPHORE = asyncio.BoundedSemaphore(SEND_CONCURRENCY)
'''

# ===================== MODELS =====================
class Attendee(BaseModel):
    name: str
    email: EmailStr
    mobile: str   # include country code; we'll normalize to digits-only
    batch: str

class BulkAttendee(BaseModel):
    attendees: List[Attendee]

class QRScanResult(BaseModel):
    qr_code: str
    timestamp: Optional[datetime] = None

# ===================== APP / DB =====================
db_pool = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_pool
    db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=5, max_size=20)
    yield
    await db_pool.close()

app = FastAPI(title="Workshop Attendance API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten for prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ===================== AUTH (simple) =====================
security = HTTPBearer()

def verify_token(auth: HTTPAuthorizationCredentials = Depends(security)):
    token = auth.credentials
    if not token:
        raise HTTPException(status_code=401, detail="Invalid token")
    return token

# ===================== HELPERS =====================
def _normalize_phone(mobile: str) -> str:
    """Digits-only, strip leading 00, add country code if 10-digit."""
    digits = "".join(ch for ch in (mobile or "") if ch.isdigit())
    if digits.startswith("00"):
        digits = digits[2:]
    if len(digits) == 10 and WATI_DEFAULT_COUNTRY_CODE:
        digits = f"{WATI_DEFAULT_COUNTRY_CODE}{digits}"
    return digits

def _bearer(token: str) -> str:
    """Ensure Authorization header is Bearer ... even if env var is raw token."""
    t = (token or "").strip()
    return t if t.lower().startswith("bearer ") else f"Bearer {t}"

async def _send_brevo_email(*, to_email: str, subject: str, text: str, attachments: Optional[List[dict]] = None) -> bool:
    """
    Send email via Brevo.
    attachments: list of {"content": <base64 string>, "name": "filename.ext"}
    """
    if not BREVO_API_KEY:
        print("[Brevo] missing API key")
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
        print("[Brevo] HTTP:", r.status_code, "body:", r.text)
        r.raise_for_status()
    return True

async def _send_wati_template(
    *, phone: str, template_name: str, params_obj: List[dict],
    broadcast_name: Optional[str] = None, channel_number: Optional[str] = None
) -> bool:
    """
    Send a WATI template using the exact shape your tenant expects:
    - parameters: [{ "name": "...", "value": "..." }, ...]
    - channel_number in JSON body (if your tenant requires it)
    - v2: recipient number in query string: ?whatsappNumber=<digits>
    Falls back to v1 and bulk variants.
    Return True only if API returns {"result": true}.
    """
    if not WATI_API_TOKEN or not WATI_BASE_URL or not template_name:
        print("[WATI] missing base/token/template; skipping")
        return False

    base = WATI_BASE_URL.rstrip("/")
    headers = {
        "Authorization": _bearer(WATI_API_TOKEN),
        "Content-Type": "application/json",
    }
    bname = broadcast_name or WATI_BROADCAST_NAME or "utility"
    chan  = channel_number or WATI_CHANNEL_NUMBER

    # v2 — number in query string
    try:
        url = f"{base}/api/v2/sendTemplateMessage?whatsappNumber={phone}"
        payload = {
            "template_name": template_name,
            "broadcast_name": bname,
            "parameters": params_obj,  # array of {name,value}
        }
        if chan:
            payload["channel_number"] = chan

        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(url, headers=headers, json=payload)
            print(f"[WATI] v2 -> {r.status_code} {r.text[:200]}")
            if r.status_code == 200:
                j = r.json()
                if isinstance(j, dict) and j.get("result") is True:
                    return True
    except Exception as e:
        print("[WATI] v2 error:", e)

    # v1 — number in body
    try:
        url = f"{base}/api/v1/sendTemplateMessage"
        payload = {
            "whatsappNumber": phone,
            "template_name": template_name,
            "broadcast_name": bname,
            "parameters": params_obj,
        }
        if chan:
            payload["channel_number"] = chan

        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(url, headers=headers, json=payload)
            print(f"[WATI] v1 -> {r.status_code} {r.text[:200]}")
            if r.status_code == 200:
                j = r.json()
                if isinstance(j, dict) and j.get("result") is True:
                    return True
    except Exception as e:
        print("[WATI] v1 error:", e)

    # v1 bulk — whatsappNumbers
    try:
        url = f"{base}/api/v1/sendTemplateMessages"
        payload = {
            "whatsappNumbers": [phone],  # plural list
            "template_name": template_name,
            "broadcast_name": bname,
            "parameters": params_obj,
        }
        if chan:
            payload["channel_number"] = chan

        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(url, headers=headers, json=payload)
            print(f"[WATI] bulk -> {r.status_code} {r.text[:200]}")
            if r.status_code == 200:
                j = r.json()
                if isinstance(j, dict) and j.get("result") is True:
                    return True
    except Exception as e:
        print("[WATI] bulk error:", e)

    # some tenants use "receivers" instead of whatsappNumbers
    try:
        url = f"{base}/api/v1/sendTemplateMessages"
        payload = {
            "receivers": [phone],
            "template_name": template_name,
            "broadcast_name": bname,
            "parameters": params_obj,
        }
        if chan:
            payload["channel_number"] = chan

        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(url, headers=headers, json=payload)
            print(f"[WATI] bulk(receivers) -> {r.status_code} {r.text[:200]}")
            if r.status_code == 200:
                j = r.json()
                if isinstance(j, dict) and j.get("result") is True:
                    return True
    except Exception as e:
        print("[WATI] bulk(receivers) error:", e)

    return False

# ===================== CORE DB OPS =====================
async def create_attendee(attendee: Attendee):
    attendee_id = str(uuid.uuid4())
    qr_data = f"WORKSHOP_ATTENDEE:{attendee_id}"

    # Generate QR PNG -> base64
    qr = qrcode.QRCode(version=1, box_size=10, border=5)
    qr.add_data(qr_data)
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    qr_img.save(buf, format="PNG")
    qr_b64 = base64.b64encode(buf.getvalue()).decode()

    async with db_pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO attendees
                (id, name, email, mobile, batch, qr_code, qr_data, created_at)
            VALUES
                ($1, $2, $3, $4, $5, $6, $7, $8)
            """,
            attendee_id, attendee.name, attendee.email, attendee.mobile,
            attendee.batch, qr_b64, qr_data, datetime.now()
        )

    return {"attendee_id": attendee_id, "qr_code": qr_b64, "qr_data": qr_data}

async def _update_send_status(attendee_id: str, email_status: str, wa_status: str,
                              sent_at: Optional[datetime], last_error: Optional[str]):
    try:
        async with db_pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE attendees
                   SET qr_email_status    = $2,
                       qr_whatsapp_status = $3,
                       qr_sent_at         = $4,
                       qr_last_error      = $5,
                       updated_at         = NOW()
                 WHERE id = $1
                """,
                attendee_id, email_status, wa_status, sent_at, last_error
            )
    except Exception as e:
        print("[WARN] status write failed:", e)

# ===================== SENDERS =====================
# --- Send QR (Brevo + WATI) ---
async def send_qr_code(attendee_id: str, attendee: Attendee, qr_code_base64: str) -> bool:
    """
    Sends QR via Brevo (email) + WATI (WhatsApp).
    Status is recorded per attendee in DB.
    """
    now_ts = datetime.now()
    email_ok = False
    wa_ok = False
    last_err: Optional[str] = None

    async with SEND_SEMAPHORE:
        # EMAIL (Brevo)
        try:
            attachments = [{"content": qr_code_base64, "name": "qr_code.png"}]
            email_ok = await _send_brevo_email(
                to_email=attendee.email,
                subject=f"Workshop QR Code - {attendee.batch}",
                text=f"Dear {attendee.name},\nYour registration is confirmed.\nBatch: {attendee.batch}\nQR attached.",
                attachments=attachments
            )
        except Exception as e:
            last_err = f"{(last_err + ' | ') if last_err else ''}Brevo error: {e}"

        # WHATSAPP (WATI) — your_qr_code: {{name}}, {{batch}}, {{qr_code}}
        try:
            phone = _normalize_phone(attendee.mobile)
            if phone and WATI_TEMPLATE_NAME_QR:
                qr_url = f"{PUBLIC_BASE_URL}/api/qr/{attendee_id}.png"
                params_obj = [
                    {"name": "name",    "value": attendee.name},
                    {"name": "batch",   "value": attendee.batch},
                    {"name": "qr_code", "value": qr_url},
                ]
                wa_ok = await _send_wati_template(
                    phone=phone,
                    template_name=WATI_TEMPLATE_NAME_QR,
                    params_obj=params_obj,
                    broadcast_name=WATI_BROADCAST_NAME
                )
                if not wa_ok:
                    last_err = (last_err + " | " if last_err else "") + "WATI QR send failed"
            else:
                print("[WATI] phone empty or QR template not set")
        except Exception as e:
            last_err = f"{(last_err + ' | ') if last_err else ''}WATI error: {e}"

    # Statuses
    email_status = "sent" if (BREVO_API_KEY and email_ok) else ("failed" if BREVO_API_KEY else "pending")
    wa_status    = "sent" if (WATI_API_TOKEN and wa_ok)   else ("failed" if WATI_API_TOKEN else "pending")

    await _update_send_status(attendee_id, email_status, wa_status, now_ts, last_err)
    return email_ok and wa_ok

# --- Send entry pass after scan ---
async def send_entry_pass(attendee_row, entry_time: datetime):
    """
    On scan, send a confirmation:
    - Email: simple text via Brevo
    - WhatsApp: your_entry_pass with variables {name}, {batch}, {email}
    """
    try:
        name = attendee_row["name"]
        email = attendee_row["email"]
        mobile = attendee_row["mobile"]
        batch = attendee_row["batch"]

        # Email (Brevo)
        try:
            await _send_brevo_email(
                to_email=email,
                subject=f"Welcome {name} — Workshop Entry Pass",
                text=(
                    f"Welcome {name}!\n"
                    f"This is your today's workshop pass.\n"
                    f"Date: {entry_time.date()}\n"
                    f"Entry time: {entry_time.strftime('%H:%M')}\n"
                    f"Batch: {batch}\n"
                    f"Please show this to BCI staff."
                )
            )
        except Exception as e:
            print("[Brevo][entry-pass] error:", e)

        # WhatsApp (WATI) — your_entry_pass: {{name}}, {{batch}}, {{email}}
        try:
            phone = _normalize_phone(mobile)
            if phone and WATI_TEMPLATE_NAME_ENTRY:
                params_obj = [
                    {"name": "name",  "value": name},
                    {"name": "batch", "value": batch},
                    {"name": "email", "value": email},
                ]
                ok = await _send_wati_template(
                    phone=phone,
                    template_name=WATI_TEMPLATE_NAME_ENTRY,
                    params_obj=params_obj,
                    broadcast_name=WATI_BROADCAST_NAME
                )
                print("[WATI] entry-pass", "sent" if ok else "failed")
            else:
                print("[WATI] entry template not set or phone empty")
        except Exception as e:
            print("[WATI][entry-pass] error:", e)

        return True
    except Exception as e:
        print("Entry pass error:", e)
        return False

# ===================== API =====================
@app.post("/api/register/bulk")
async def bulk_register(body: BulkAttendee, token: str = Depends(verify_token)):
    created = []
    for a in body.attendees:
        res = await create_attendee(a)
        created.append((a, res["attendee_id"], res["qr_code"]))
    await asyncio.gather(*(send_qr_code(aid, a, qr) for (a, aid, qr) in created))

    data = [{
        "name": a.name, "email": a.email, "mobile": a.mobile,
        "batch": a.batch, "attendee_id": aid, "qr_code": qr
    } for (a, aid, qr) in created]
    return {"message": f"Successfully registered {len(created)} attendees", "data": data}

@app.post("/api/register/single")
async def single_register(attendee: Attendee, token: str = Depends(verify_token)):
    res = await create_attendee(attendee)
    await send_qr_code(res["attendee_id"], attendee, res["qr_code"])
    return {
        "message": "Attendee registered successfully",
        "attendee_id": res["attendee_id"],
        "qr_code": res["qr_code"],
        "name": attendee.name,
        "email": attendee.email,
        "batch": attendee.batch
    }

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

            entry_time = datetime.now()
            await conn.execute(
                "INSERT INTO attendance (attendee_id, entry_time, created_at) VALUES ($1, $2, $3)",
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
            """
            SELECT a.batch,
                   COUNT(a.id) AS total_registered,
                   COUNT(att.id) AS total_attended
              FROM attendees a
              LEFT JOIN attendance att ON a.id = att.attendee_id
             GROUP BY a.batch
            """
        )
    return {
        "total_attendees": total,
        "marked_attendance": attended,
        "attendance_rate": round((attended / total) * 100, 2) if total > 0 else 0,
        "batch_wise_data": [dict(r) for r in batch_rows]
    }

@app.post("/api/upload/csv")
async def upload_csv(file: UploadFile = File(...), token: str = Depends(verify_token)):
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are allowed")
    try:
        content = await file.read()
        df = pd.read_csv(io.StringIO(content.decode("utf-8-sig")))
        required = ["name", "email", "mobile", "batch"]
        if not all(col in df.columns for col in required):
            raise HTTPException(status_code=400, detail=f"CSV must contain columns: {required}")

        attendees: List[Attendee] = []
        for _, row in df.iterrows():
            attendees.append(Attendee(
                name=str(row["name"]).strip(),
                email=EmailStr(str(row["email"]).strip()),
                mobile=str(row["mobile"]).strip(),
                batch=str(row["batch"]).strip()
            ))

        created = []
        for a in attendees:
            res = await create_attendee(a)
            created.append((a, res["attendee_id"], res["qr_code"]))

        await asyncio.gather(*(send_qr_code(aid, a, qr) for (a, aid, qr) in created))
        return {"message": f"Successfully processed {len(created)} attendees from CSV",
                "total_processed": len(created)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing CSV: {str(e)}")

# Public PNG for WA / recipients (NO auth so links work in WhatsApp/email)
@app.get("/api/qr/{attendee_id}.png")
async def get_qr_png(attendee_id: str):
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("SELECT qr_code FROM attendees WHERE id=$1", attendee_id)
        if not row:
            raise HTTPException(status_code=404, detail="QR not found")
        png_bytes = base64.b64decode(row["qr_code"])
        return StreamingResponse(io.BytesIO(png_bytes), media_type="image/png")

# Retry pending/failed
@app.post("/api/resend/pending")
async def resend_pending(limit: int = 200, token: str = Depends(verify_token)):
    async with db_pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, name, email, mobile, batch, qr_code
              FROM attendees
             WHERE (qr_email_status <> 'sent' OR qr_whatsapp_status <> 'sent')
             ORDER BY created_at
             LIMIT $1
            """, limit
        )
    results = await asyncio.gather(
        *(send_qr_code(r["id"],
                       Attendee(name=r["name"], email=r["email"], mobile=r["mobile"], batch=r["batch"]),
                       r["qr_code"]) for r in rows),
        return_exceptions=True
    )
    ok = sum(1 for r in results if r is True)
    return {"retried": len(rows), "success": ok, "failed": len(rows) - ok}

@app.get("/api/health")
async def health():
    return {"ok": True}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
