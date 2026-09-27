// API_BASE_URL is set in config.js — edit that file with your deployed backend's
// public Railway URL after you deploy the backend service.
const API_BASE = (window.API_BASE_URL || "http://localhost:3000") + "/api";

let selectedTime = null;
let currentPatient = null;

function getToken() { return sessionStorage.getItem("patientToken"); }
function setToken(t) { sessionStorage.setItem("patientToken", t); }
function clearToken() { sessionStorage.removeItem("patientToken"); }

function authHeaders() {
  return { "Authorization": "Bearer " + getToken(), "Content-Type": "application/json" };
}

function showView(view) {
  ["login", "register", "booking"].forEach((v) => {
    document.getElementById("view-" + v).style.display = v === view ? "block" : "none";
  });
  document.getElementById("logout-link").style.display = view === "booking" ? "inline-block" : "none";
  document.getElementById("topbar-sub").textContent = view === "booking" ? "Patient Portal" : "Log in or create an account";
}

function switchTab(tab) {
  document.getElementById("tab-book").classList.toggle("active", tab === "book");
  document.getElementById("tab-history").classList.toggle("active", tab === "history");
  document.getElementById("panel-book").style.display = tab === "book" ? "block" : "none";
  document.getElementById("panel-history").style.display = tab === "history" ? "block" : "none";
  if (tab === "history") loadHistory();
}

// ---------------- Login / Register / Logout ----------------
async function doLogin() {
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const errBox = document.getElementById("login-error");
  errBox.style.display = "none";

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      errBox.textContent = data.error || "Could not log in.";
      errBox.style.display = "block";
      return;
    }
    setToken(data.token);
    currentPatient = data.patient;
    enterBookingView();
  } catch (err) {
    errBox.textContent = "Couldn't reach the clinic system. Is the backend running?";
    errBox.style.display = "block";
  }
}

async function doRegister() {
  const name = document.getElementById("reg-name").value.trim();
  const contact = document.getElementById("reg-contact").value.trim();
  const email = document.getElementById("reg-email").value.trim();
  const password = document.getElementById("reg-password").value;
  const errBox = document.getElementById("register-error");
  errBox.style.display = "none";

  if (!name || !contact || !email || !password) {
    errBox.textContent = "Please fill in every field.";
    errBox.style.display = "block";
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, contact, email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      errBox.textContent = data.error || "Could not create your account.";
      errBox.style.display = "block";
      return;
    }
    setToken(data.token);
    currentPatient = data.patient;
    enterBookingView();
  } catch (err) {
    errBox.textContent = "Couldn't reach the clinic system. Is the backend running?";
    errBox.style.display = "block";
  }
}

async function logout() {
  try {
    await fetch(`${API_BASE}/auth/logout`, { method: "POST", headers: authHeaders() });
  } catch (err) { /* fine either way, we're clearing the local token regardless */ }
  clearToken();
  currentPatient = null;
  document.getElementById("login-email").value = "";
  document.getElementById("login-password").value = "";
  showView("login");
}

// ---------------- Entering the booking view after login/register/resume ----------------
async function enterBookingView() {
  showView("booking");
  document.getElementById("welcome-line").textContent =
    `Hi ${currentPatient.name.split(" ")[0]} \u2014 pick a date and an open time below.`;
  switchTab("book");
  loadSlots();
}

// On page load, if we already have a session token, try to resume it instead of asking to log in again
async function tryResumeSession() {
  const token = getToken();
  if (!token) { showView("login"); return; }
  try {
    const res = await fetch(`${API_BASE}/me`, { headers: authHeaders() });
    if (!res.ok) { clearToken(); showView("login"); return; }
    currentPatient = await res.json();
    enterBookingView();
  } catch (err) {
    showView("login");
  }
}

// ---------------- Booking ----------------
const dateInput = () => document.getElementById("pt-date");
const slotGrid = () => document.getElementById("slot-grid");
const submitBtn = () => document.getElementById("submit-btn");

function initDatePicker() {
  const today = new Date().toISOString().slice(0, 10);
  dateInput().value = today;
  dateInput().min = today;
  dateInput().addEventListener("change", loadSlots);
  document.getElementById("reason").addEventListener("input", updateSubmitState);
}

async function loadSlots() {
  selectedTime = null;
  updateSubmitState();
  slotGrid().innerHTML = `<div class="slot-loading">Loading available times\u2026</div>`;
  try {
    const res = await fetch(`${API_BASE}/slots?date=${dateInput().value}`);
    if (!res.ok) throw new Error("bad response");
    const data = await res.json();
    document.getElementById("conn-banner").style.display = "none";
    renderSlots(data.allSlots, data.openSlots);
  } catch (err) {
    document.getElementById("conn-banner").style.display = "block";
    slotGrid().innerHTML = `<div class="slot-empty">Unable to load time slots.</div>`;
  }
}

function renderSlots(allSlots, openSlots) {
  slotGrid().innerHTML = "";
  allSlots.forEach((time) => {
    const isOpen = openSlots.includes(time);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "slot-btn" + (isOpen ? "" : " taken");
    btn.textContent = time;
    btn.disabled = !isOpen;
    if (isOpen) btn.onclick = () => selectSlot(time, btn);
    slotGrid().appendChild(btn);
  });
}

function selectSlot(time, btnEl) {
  selectedTime = time;
  document.querySelectorAll(".slot-btn").forEach((b) => b.classList.remove("selected"));
  btnEl.classList.add("selected");
  updateSubmitState();
}

function updateSubmitState() {
  const reason = document.getElementById("reason").value.trim();
  submitBtn().disabled = !(reason && selectedTime && dateInput().value);
}

function initBookingForm() {
  document.getElementById("booking-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorBox = document.getElementById("form-error");
    const successBox = document.getElementById("form-success");
    errorBox.style.display = "none";
    successBox.style.display = "none";
    submitBtn().disabled = true;
    submitBtn().textContent = "Booking\u2026";

    const payload = {
      date: dateInput().value,
      time: selectedTime,
      reason: document.getElementById("reason").value.trim(),
    };

    try {
      const res = await fetch(`${API_BASE}/appointments`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        errorBox.textContent = data.error || "Something went wrong. Please try again.";
        errorBox.style.display = "block";
        submitBtn().textContent = "Confirm Booking";
        loadSlots();
        return;
      }
      document.getElementById("confirm-details").textContent =
        `You're set for ${payload.date} at ${payload.time}. Reason: ${payload.reason}. We'll see you then!`;
      document.getElementById("confirm-modal").classList.add("active");
    } catch (err) {
      document.getElementById("conn-banner").style.display = "block";
      errorBox.textContent = "Couldn't reach the clinic system. Please try again in a moment.";
      errorBox.style.display = "block";
    } finally {
      submitBtn().textContent = "Confirm Booking";
    }
  });
}

function closeConfirm() {
  document.getElementById("confirm-modal").classList.remove("active");
  document.getElementById("booking-form").reset();
  const today = new Date().toISOString().slice(0, 10);
  dateInput().value = today;
  selectedTime = null;
  loadSlots();
  updateSubmitState();
}

// ---------------- My Appointments (scoped to the logged-in patient only) ----------------
async function loadHistory() {
  const list = document.getElementById("history-list");
  list.innerHTML = `<div class="slot-loading">Loading your appointments\u2026</div>`;
  try {
    const res = await fetch(`${API_BASE}/me/appointments`, { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) {
      list.innerHTML = `<div class="slot-empty">Could not load your appointments.</div>`;
      return;
    }
    if (data.appointments.length === 0) {
      list.innerHTML = `<div class="slot-empty">No appointments yet \u2014 book one from the other tab.</div>`;
      return;
    }
    const sorted = [...data.appointments].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).reverse();
    list.innerHTML = "";
    sorted.forEach((a) => {
      const row = document.createElement("div");
      row.className = "history-row";
      row.innerHTML = `
        <div>
          <div class="history-main">${a.date} \u00b7 ${a.time}</div>
          <div class="history-sub">${a.reason}</div>
        </div>
        <span class="history-badge ${a.status === "cancelled" ? "cancelled" : "confirmed"}">${a.status === "cancelled" ? "Cancelled" : "Confirmed"}</span>`;
      list.appendChild(row);
    });
  } catch (err) {
    list.innerHTML = `<div class="slot-empty">Couldn't reach the clinic system.</div>`;
  }
}

// ---------------- Boot ----------------
initDatePicker();
initBookingForm();
tryResumeSession();
