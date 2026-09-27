const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const DB_PATH = path.join(__dirname, "db.json");
// Railway assigns its own port at runtime via process.env.PORT — a hardcoded
// port will fail to bind on their infrastructure, so always fall back to it.
const PORT = process.env.PORT || 3000;

// Comma-separated list of allowed origins, e.g. "https://admin.example.com,https://patients.example.com"
// Left unset (default) = allow any origin, which is fine for this prototype since
// there's no cookie-based auth (token is sent explicitly via Authorization header).
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim())
  : null;

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// Seed the JSON "database" on first run, using TODAY's date rather than a
// hardcoded one baked into the repo — otherwise demo appointments would
// silently stop showing up on the admin dashboard the day after cloning.
function seedIfMissing() {
  if (fs.existsSync(DB_PATH)) return;
  const today = todayStr();
  const seed = {
    patients: [
      { id: "D-2039", name: "Juan Dela Cruz", contact: "0917 123 4567", lastVisit: "Jan 12, 2026", nextVisit: today, status: "Active",
        dental: "Routine cleanings every 6 months. No major procedures on file.", medical: "No known allergies." },
      { id: "D-1142", name: "Maria Clara", contact: "0918 555 2211", lastVisit: "Feb 20, 2026", nextVisit: today, status: "At Risk",
        dental: "Upper left molar extraction scheduled. Missed 2 prior appointments.", medical: "Penicillin allergy \u2014 noted for prescriptions." },
      { id: "D-9982", name: "Roberto Blanco", contact: "0919 888 3344", lastVisit: "May 5, 2026", nextVisit: "\u2014", status: "New",
        dental: "First visit on file \u2014 no prior history.", medical: "None recorded yet." },
      { id: "D-3321", name: "Elena Guerrero", contact: "0920 222 7788", lastVisit: "Dec 15, 2025", nextVisit: "\u2014", status: "Active",
        dental: "Ongoing orthodontic monitoring, no adjustments needed.", medical: "Type 2 diabetes \u2014 managed, monitor healing time." },
    ],
    appointments: [
      { id: "A-0001", date: today, time: "9:00 AM", reason: "Regular Checkup & Cleaning", patientId: "D-2039", status: "confirmed", riskFlag: false, source: "admin", createdAt: new Date().toISOString() },
      { id: "A-0002", date: today, time: "10:00 AM", reason: "Tooth Extraction - Upper Left Molar", patientId: "D-1142", status: "confirmed", riskFlag: true, source: "admin", createdAt: new Date().toISOString() },
      { id: "A-0003", date: today, time: "11:00 AM", reason: "Walk-in Consultation", patientId: "D-9982", status: "cancelled", riskFlag: false, source: "admin", createdAt: new Date().toISOString() },
    ],
    // Patient-portal accounts (separate from admin login, which is hardcoded client-side).
    users: [],       // { email, passwordHash, patientId }
    sessions: {},    // { token: patientId }
  };
  fs.writeFileSync(DB_PATH, JSON.stringify(seed, null, 2));
  console.log("Seeded db.json with starter patients and today's schedule.");
}

seedIfMissing();

const app = express();
app.use(
  ALLOWED_ORIGINS
    ? cors({ origin: ALLOWED_ORIGINS })
    : cors() // permissive by default — see ALLOWED_ORIGINS note above
);
app.use(express.json());

// ---------- tiny JSON-file "database" ----------
function readDB() {
  const db = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  // Backfill in case an older db.json (pre-auth) is already on disk.
  if (!db.users) db.users = [];
  if (!db.sessions) db.sessions = {};
  return db;
}
function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}
function nextId(items, prefix) {
  const max = items.reduce((m, it) => {
    const n = parseInt(String(it.id).replace(prefix, ""), 10);
    return isNaN(n) ? m : Math.max(m, n);
  }, 0);
  return prefix + String(max + 1).padStart(4, "0");
}

const ALL_SLOTS = ["9:00 AM", "10:00 AM", "11:00 AM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM"];

// ================= AUTH (patient portal) =================
// Simple opaque bearer tokens stored in db.json's "sessions" map. Good enough
// for a prototype; swap for JWTs or a real session store before production use.

function issueToken(patientId) {
  const db = readDB();
  const token = crypto.randomBytes(24).toString("hex");
  db.sessions[token] = patientId;
  writeDB(db);
  return token;
}

// Attaches req.patientId if a valid bearer token is present; does NOT reject
// the request on its own (some routes are usable both with and without auth).
function attachPatientFromToken(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  const db = readDB();
  return db.sessions[token] || null;
}

// Rejects the request with 401 if there's no valid token.
function requireAuth(req, res, next) {
  const patientId = attachPatientFromToken(req);
  if (!patientId) return res.status(401).json({ error: "Not logged in." });
  req.patientId = patientId;
  next();
}

app.post("/api/auth/register", async (req, res) => {
  const { name, contact, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: "name, email, and password are required" });
  }
  const db = readDB();
  const normalizedEmail = String(email).trim().toLowerCase();
  if (db.users.find((u) => u.email === normalizedEmail)) {
    return res.status(409).json({ error: "An account with that email already exists." });
  }

  const patient = {
    id: nextId(db.patients, "D-"),
    name,
    contact: contact || "\u2014",
    lastVisit: "\u2014",
    nextVisit: "\u2014",
    status: "New",
    dental: "No prior history \u2014 first visit.",
    medical: "Not yet recorded.",
  };
  db.patients.push(patient);

  const passwordHash = await bcrypt.hash(password, 10);
  db.users.push({ email: normalizedEmail, passwordHash, patientId: patient.id });
  writeDB(db);

  const token = issueToken(patient.id);
  res.status(201).json({ token, patient });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }
  const db = readDB();
  const normalizedEmail = String(email).trim().toLowerCase();
  const user = db.users.find((u) => u.email === normalizedEmail);
  if (!user) return res.status(401).json({ error: "Invalid email or password." });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Invalid email or password." });

  const patient = db.patients.find((p) => p.id === user.patientId);
  const token = issueToken(user.patientId);
  res.json({ token, patient });
});

app.post("/api/auth/logout", requireAuth, (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.slice(7);
  const db = readDB();
  delete db.sessions[token];
  writeDB(db);
  res.json({ ok: true });
});

app.get("/api/me", requireAuth, (req, res) => {
  const db = readDB();
  const patient = db.patients.find((p) => p.id === req.patientId);
  if (!patient) return res.status(404).json({ error: "Patient not found" });
  res.json(patient);
});

app.get("/api/me/appointments", requireAuth, (req, res) => {
  const db = readDB();
  const appointments = db.appointments.filter((a) => a.patientId === req.patientId);
  res.json({ appointments });
});

// ================= PATIENTS (admin) =================

// GET all patients (admin: Patient Records view)
app.get("/api/patients", (req, res) => {
  const db = readDB();
  res.json(db.patients);
});

// GET one patient (profile modal)
app.get("/api/patients/:id", (req, res) => {
  const db = readDB();
  const patient = db.patients.find((p) => p.id === req.params.id);
  if (!patient) return res.status(404).json({ error: "Patient not found" });
  res.json(patient);
});

// ================= APPOINTMENTS =================

// GET appointments for a given date (defaults to today) — used by the admin dashboard
app.get("/api/appointments", (req, res) => {
  const db = readDB();
  const date = req.query.date || todayStr();
  const dayAppointments = db.appointments.filter((a) => a.date === date);
  res.json({ date, appointments: dayAppointments });
});

// GET open slots for a given date — used by the patient site so it only offers free times
app.get("/api/slots", (req, res) => {
  const db = readDB();
  const date = req.query.date || todayStr();
  const taken = db.appointments
    .filter((a) => a.date === date && a.status !== "cancelled")
    .map((a) => a.time);
  const open = ALL_SLOTS.filter((s) => !taken.includes(s));
  res.json({ date, openSlots: open, allSlots: ALL_SLOTS });
});

// POST a new appointment — used by BOTH the patient site (public booking, now
// authenticated) and the admin panel (staff booking, unauthenticated).
app.post("/api/appointments", (req, res) => {
  const db = readDB();
  const { date, time, reason, patientId, newPatientName, newPatientContact, source } = req.body;

  if (!date || !time || !reason) {
    return res.status(400).json({ error: "date, time, and reason are required" });
  }
  if (!ALL_SLOTS.includes(time)) {
    return res.status(400).json({ error: "Not a valid clinic time slot" });
  }

  // conflict check — the whole reason this lives server-side now instead of in each frontend's memory
  const conflict = db.appointments.find(
    (a) => a.date === date && a.time === time && a.status !== "cancelled"
  );
  if (conflict) {
    return res.status(409).json({ error: `The ${time} slot on ${date} is already booked.` });
  }

  // If the request carries a valid patient bearer token (the patient site), that
  // identity always wins over anything in the body — a logged-in patient can only
  // book for themselves.
  const authedPatientId = attachPatientFromToken(req);
  let finalPatientId = authedPatientId || patientId;
  let finalSource = authedPatientId ? "patient" : (source === "patient" ? "patient" : "admin");

  if (!finalPatientId) {
    if (!newPatientName) {
      return res.status(400).json({ error: "patientId or newPatientName is required" });
    }
    const newPatient = {
      id: nextId(db.patients, "D-"),
      name: newPatientName,
      contact: newPatientContact || "\u2014",
      lastVisit: "\u2014",
      nextVisit: date,
      status: "New",
      dental: "No prior history \u2014 first visit.",
      medical: "Not yet recorded.",
    };
    db.patients.push(newPatient);
    finalPatientId = newPatient.id;
  }

  const appointment = {
    id: nextId(db.appointments, "A-"),
    date,
    time,
    reason,
    patientId: finalPatientId,
    status: "confirmed",
    riskFlag: false,
    source: finalSource,
    createdAt: new Date().toISOString(),
  };
  db.appointments.push(appointment);
  writeDB(db);

  const patient = db.patients.find((p) => p.id === finalPatientId);
  res.status(201).json({ appointment, patient });
});

// PATCH cancel an appointment — used by the admin panel
app.patch("/api/appointments/:id/cancel", (req, res) => {
  const db = readDB();
  const appt = db.appointments.find((a) => a.id === req.params.id);
  if (!appt) return res.status(404).json({ error: "Appointment not found" });
  appt.status = "cancelled";
  writeDB(db);
  res.json({ appointment: appt });
});

app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`Dental clinic backend running on port ${PORT}`);
  console.log(`Patient site and admin panel should point their API calls here.`);
});
