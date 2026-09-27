// API_BASE_URL is set in config.js — edit that file with your deployed backend's
// public Railway URL after you deploy the backend service.
const API_BASE = (window.API_BASE_URL || "http://localhost:3000") + "/api";

// ---------------- Local caches (mirrors of what the backend has) ----------------
let patients = [];
let todaysAppointments = []; // raw appointment records for the selected date
let allSlots = [];
let currentPatientType = "existing";
let pollTimer = null;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2400);
}

function showConnIssue() {
  showToast("Can't reach the clinic backend \u2014 make sure the server is running on localhost:3000.");
}

// ---------------- Login ----------------
function attemptLogin() {
  const u = document.getElementById("username").value.trim();
  const p = document.getElementById("password").value;
  const err = document.getElementById("login-error");
  if (u === "secretary" && p === "clinic123") {
    err.style.display = "none";
    document.getElementById("login-screen").style.display = "none";
    document.getElementById("app-screen").style.display = "block";
    initApp();
  } else {
    err.style.display = "block";
  }
}
document.getElementById("password").addEventListener("keydown", (e) => { if (e.key === "Enter") attemptLogin(); });

function logout() {
  document.getElementById("app-screen").style.display = "none";
  document.getElementById("login-screen").style.display = "grid";
  document.getElementById("username").value = "";
  document.getElementById("password").value = "";
  if (pollTimer) clearInterval(pollTimer);
}

// ---------------- View switching ----------------
function switchView(view) {
  document.querySelectorAll(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.view === view));
  document.querySelectorAll(".view").forEach(el => el.classList.remove("active"));
  document.getElementById("view-" + view).classList.add("active");
}

// ---------------- Init ----------------
async function initApp() {
  const dateLabel = document.getElementById("today-date-label");
  dateLabel.textContent = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  document.getElementById("appt-date").valueAsDate = new Date();

  await refreshAll();

  // Patients can book from the separate patient site at any time, so poll
  // the backend periodically to keep the admin dashboard in sync.
  pollTimer = setInterval(refreshAll, 5000);
}

async function refreshAll() {
  await Promise.all([loadPatients(), loadTodaysSchedule()]);
  renderRecords(patients);
  renderPatientSelect();
  renderSchedule();
}

// ---------------- Data loading ----------------
async function loadPatients() {
  try {
    const res = await fetch(`${API_BASE}/patients`);
    patients = await res.json();
  } catch (err) {
    showConnIssue();
  }
}

async function loadTodaysSchedule() {
  try {
    const [apptRes, slotRes] = await Promise.all([
      fetch(`${API_BASE}/appointments?date=${todayStr()}`),
      fetch(`${API_BASE}/slots?date=${todayStr()}`),
    ]);
    const apptData = await apptRes.json();
    const slotData = await slotRes.json();
    todaysAppointments = apptData.appointments;
    allSlots = slotData.allSlots;
  } catch (err) {
    showConnIssue();
  }
}

// ---------------- Schedule rendering ----------------
function renderSchedule() {
  const list = document.getElementById("schedule-list");
  list.innerHTML = "";

  allSlots.forEach((time) => {
    const appt = todaysAppointments.find(a => a.time === time && a.status !== "cancelled");
    const cancelled = todaysAppointments.find(a => a.time === time && a.status === "cancelled");
    const row = document.createElement("div");
    row.className = "slot-row";

    if (appt) {
      const pt = patients.find(p => p.id === appt.patientId);
      const badge = appt.riskFlag
        ? `<span class="badge risk">High no-show risk</span>`
        : `<span class="badge ok">${appt.source === "patient" ? "Booked online" : "Reminder sent"}</span>`;
      row.innerHTML = `
        <div class="slot-time">${time}</div>
        <div>
          <div class="slot-patient">${pt ? pt.name : "Unknown"}</div>
          <div class="slot-reason">${appt.reason}</div>
        </div>
        ${badge}
        <div class="row-actions">
          <button onclick="viewProfile('${appt.patientId}')">View</button>
          <button onclick="cancelAppointment('${appt.id}')">Cancel</button>
        </div>`;
    } else if (cancelled) {
      row.innerHTML = `
        <div class="slot-time">${time}</div>
        <div class="empty-slot">Cancelled \u2014 flagged for reassignment</div>
        <div class="badge cancelled">Cancelled</div>
        <div class="row-actions"><button onclick="openBookingModal('${time}')">Reassign</button></div>`;
    } else {
      row.innerHTML = `
        <div class="slot-time">${time}</div>
        <div class="empty-slot">Open slot</div>
        <div></div>
        <div class="row-actions"><button onclick="openBookingModal('${time}')">Book</button></div>`;
    }
    list.appendChild(row);
  });
}

async function cancelAppointment(apptId) {
  try {
    const res = await fetch(`${API_BASE}/appointments/${apptId}/cancel`, { method: "PATCH" });
    if (!res.ok) throw new Error("cancel failed");
    await refreshAll();
    showToast("Appointment cancelled \u2014 slot flagged as available for reassignment.");
  } catch (err) {
    showConnIssue();
  }
}

// ---------------- Patient records ----------------
function renderRecords(list) {
  const tbody = document.getElementById("records-tbody");
  document.getElementById("records-count-label").textContent = `${patients.length} patients on file`;
  tbody.innerHTML = "";
  list.forEach(p => {
    const initials = p.name.split(" ").map(w => w[0]).slice(0, 2).join("");
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><div class="pt-name"><div class="pt-avatar">${initials}</div>${p.name}</div></td>
      <td>${p.lastVisit}</td>
      <td>${p.nextVisit}</td>
      <td><span class="badge ok">${p.status}</span></td>
      <td><button class="link-btn" onclick="viewProfile('${p.id}')">View record</button></td>`;
    tbody.appendChild(tr);
  });
}

function handleGlobalSearch() {
  const q = document.getElementById("global-search").value.toLowerCase();
  const filtered = patients.filter(p => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
  switchView("records");
  renderRecords(filtered);
}

function viewProfile(patientId) {
  const p = patients.find(x => x.id === patientId);
  if (!p) return;
  document.getElementById("profile-name").textContent = p.name + " \u2014 " + p.id;
  document.getElementById("profile-contact").textContent = p.contact;
  document.getElementById("profile-dental").textContent = p.dental;
  document.getElementById("profile-medical").textContent = p.medical;
  document.getElementById("profile-status").textContent = p.status;
  document.getElementById("profile-modal").classList.add("active");
}

// ---------------- Booking modal (staff-side booking, same backend as the patient site) ----------------
function renderPatientSelect() {
  const sel = document.getElementById("patient-select");
  sel.innerHTML = patients.map(p => `<option value="${p.id}">${p.name} (${p.id})</option>`).join("");
}

function setPatientType(type) {
  currentPatientType = type;
  document.getElementById("toggle-existing").classList.toggle("active", type === "existing");
  document.getElementById("toggle-new").classList.toggle("active", type === "new");
  document.getElementById("existing-patient-field").style.display = type === "existing" ? "block" : "none";
  document.getElementById("new-patient-field").style.display = type === "new" ? "block" : "none";
}

function openBookingModal(prefTime) {
  document.getElementById("booking-error").style.display = "none";
  document.getElementById("appt-reason").value = "";
  document.getElementById("new-patient-name").value = "";
  if (prefTime) document.getElementById("appt-time").value = prefTime;
  document.getElementById("booking-modal").classList.add("active");
}

function closeModal(id) {
  document.getElementById(id).classList.remove("active");
}

async function confirmBooking() {
  const time = document.getElementById("appt-time").value;
  const reason = document.getElementById("appt-reason").value.trim();
  const errBox = document.getElementById("booking-error");
  errBox.style.display = "none";

  if (!reason) {
    errBox.textContent = "Please enter a reason for the visit.";
    errBox.style.display = "block";
    return;
  }

  const payload = { date: document.getElementById("appt-date").value || todayStr(), time, reason, source: "admin" };

  if (currentPatientType === "existing") {
    payload.patientId = document.getElementById("patient-select").value;
  } else {
    const name = document.getElementById("new-patient-name").value.trim();
    if (!name) {
      errBox.textContent = "Please enter the new patient's name.";
      errBox.style.display = "block";
      return;
    }
    payload.newPatientName = name;
  }

  try {
    const res = await fetch(`${API_BASE}/appointments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      // e.g. 409 — someone (maybe a patient booking online) took the slot first
      errBox.textContent = data.error || "Could not book that slot.";
      errBox.style.display = "block";
      await refreshAll();
      return;
    }
    await refreshAll();
    closeModal("booking-modal");
    showToast("Appointment booked and confirmation sent.");
  } catch (err) {
    showConnIssue();
  }
}
