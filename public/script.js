/**
 * Smart Parking System - Dashboard Client Script
 * Handles real-time polling (1.5s), KPI updates, interactive parking visualizer,
 * slot reservation & cancellation, hardware status sync, and Tab management.
 */

// Global State
let currentUser = null;
let authToken = null;
let pollingInterval = null;
let lastStatusData = null;

// DOM Elements
const htmlElem = document.documentElement;
const themeToggleBtn = document.getElementById('theme-toggle');
const themeIcon = document.getElementById('theme-icon');
const userDisplayName = document.getElementById('user-display-name');
const logoutBtn = document.getElementById('logout-btn');
const istClockElem = document.getElementById('ist-clock');

// Tabs
const tabBtnDashboard = document.getElementById('tab-btn-dashboard');
const tabBtnSlots = document.getElementById('tab-btn-slots');
const tabBtnReservations = document.getElementById('tab-btn-reservations');

const tabContentDashboard = document.getElementById('tab-content-dashboard');
const tabContentSlots = document.getElementById('tab-content-slots');
const tabContentReservations = document.getElementById('tab-content-reservations');

// ESP8266 Status Elements
const espStatusDot = document.getElementById('esp-status-dot');
const espStatusText = document.getElementById('esp-status-text');
const espStatusContainer = document.getElementById('esp-status-container');

// KPI Elements
const kpiTotalSlots = document.getElementById('kpi-total-slots');
const kpiAvailableSlots = document.getElementById('kpi-available-slots');
const kpiReservedSlots = document.getElementById('kpi-reserved-slots');
const kpiOccupiedSlots = document.getElementById('kpi-occupied-slots');

// ============================================================
// 1. Initialization & Authentication Check
// ============================================================
function initAuth() {
  authToken = localStorage.getItem('smart_parking_token');
  const userJson = localStorage.getItem('smart_parking_user');

  if (userJson) {
    try {
      currentUser = JSON.parse(userJson);
      userDisplayName.textContent = currentUser.name || 'User';
    } catch (e) {
      currentUser = { name: 'User', id: 1 };
    }
  } else {
    // If testing without login, set guest user
    currentUser = { name: 'Demo User', id: 1, email: 'demo@parking.com' };
  }

  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('smart_parking_token');
    localStorage.removeItem('smart_parking_user');
    showToast('Signed out successfully', 'info');
    setTimeout(() => {
      window.location.href = 'index.html';
    }, 500);
  });
}

// ============================================================
// 2. Theme Management (Light / Dark Mode with Persistence)
// ============================================================
function initTheme() {
  function applyTheme(theme) {
    if (theme === 'dark') {
      htmlElem.setAttribute('data-theme', 'dark');
      themeIcon.textContent = '☀️';
    } else {
      htmlElem.setAttribute('data-theme', 'light');
      themeIcon.textContent = '🌙';
    }
    localStorage.setItem('smart_parking_theme', theme);
  }

  const savedTheme = localStorage.getItem('smart_parking_theme') || 
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(savedTheme);

  themeToggleBtn.addEventListener('click', () => {
    const current = htmlElem.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });
}

// ============================================================
// 3. Indian Standard Time (IST) Real-Time Clock
// ============================================================
function startISTClock() {
  function updateClock() {
    const options = {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    };
    const istTimeStr = new Date().toLocaleTimeString('en-IN', options);
    istClockElem.textContent = `IST: ${istTimeStr}`;
  }
  updateClock();
  setInterval(updateClock, 1000);
}

// ============================================================
// 4. Tab Switching Logic
// ============================================================
function initTabs() {
  function switchTab(activeBtn, activeContent) {
    [tabBtnDashboard, tabBtnSlots, tabBtnReservations].forEach(btn => btn.classList.remove('active'));
    [tabContentDashboard, tabContentSlots, tabContentReservations].forEach(content => content.classList.add('hidden'));

    activeBtn.classList.add('active');
    activeContent.classList.remove('hidden');

    if (activeContent === tabContentSlots) {
      fetchSlotsData();
    } else if (activeContent === tabContentReservations) {
      fetchReservationsData();
    }
  }

  tabBtnDashboard.addEventListener('click', () => switchTab(tabBtnDashboard, tabContentDashboard));
  tabBtnSlots.addEventListener('click', () => switchTab(tabBtnSlots, tabContentSlots));
  tabBtnReservations.addEventListener('click', () => switchTab(tabBtnReservations, tabContentReservations));
}

// ============================================================
// 5. Toast Notification System
// ============================================================
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const typeClasses = {
    success: 'toast-success',
    error: 'toast-error',
    warning: 'toast-warning',
    info: 'toast-info'
  };
  const typeIcons = {
    success: '✅',
    error: '⚠️',
    warning: '🔔',
    info: 'ℹ️'
  };

  toast.className = `toast ${typeClasses[type] || 'toast-info'}`;
  toast.innerHTML = `
    <span class="text-xl">${typeIcons[type] || '✨'}</span>
    <div class="flex-1 text-sm font-semibold">${message}</div>
    <button class="text-white/80 hover:text-white text-base font-bold ml-2" onclick="this.parentElement.remove()">✕</button>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(15px) scale(0.95)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ============================================================
// 6. Real-Time Status Polling (Every 1.5 Seconds)
// ============================================================
async function fetchParkingStatus() {
  try {
    const res = await fetch('/api/parking/status');
    if (!res.ok) return;
    const data = await res.json();
    lastStatusData = data;
    renderStatus(data);
  } catch (err) {
    console.warn('Network issue fetching parking status:', err);
  }
}

function renderStatus(data) {
  // Update KPI Cards
  kpiTotalSlots.textContent = data.totalSlots ?? 2;
  kpiAvailableSlots.textContent = data.availableSlots ?? 0;
  kpiReservedSlots.textContent = data.reservedSlots ?? 0;
  kpiOccupiedSlots.textContent = data.occupiedSlots ?? 0;

  // Update ESP8266 Live Online / Offline Status
  if (data.espOnline) {
    espStatusDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 pulse-green';
    espStatusText.textContent = 'ESP8266: ONLINE';
    espStatusText.className = 'text-xs font-bold tracking-wide text-emerald-600 dark:text-emerald-400';
    espStatusContainer.className = 'flex items-center space-x-2 px-3.5 py-1.5 rounded-full border border-emerald-300 dark:border-emerald-800 bg-emerald-50/80 dark:bg-emerald-950/40 shadow-sm transition-all';
  } else {
    espStatusDot.className = 'w-2.5 h-2.5 rounded-full bg-rose-500 pulse-red';
    const lastSeenText = data.espLastSeenSecondsAgo !== null ? ` (${data.espLastSeenSecondsAgo}s ago)` : '';
    espStatusText.textContent = `ESP8266: OFFLINE${lastSeenText}`;
    espStatusText.className = 'text-xs font-bold tracking-wide text-rose-600 dark:text-rose-400';
    espStatusContainer.className = 'flex items-center space-x-2 px-3.5 py-1.5 rounded-full border border-rose-300 dark:border-rose-800 bg-rose-50/80 dark:bg-rose-950/40 shadow-sm transition-all';
  }

  // Update Slot 1 & Slot 2 Visual Cards
  if (data.slots) {
    updateSlotCardUI(1, data.slots.slot1);
    updateSlotCardUI(2, data.slots.slot2);
  }
}

function updateSlotCardUI(slotNum, slotData) {
  if (!slotData) return;

  const card = document.getElementById(`slot-card-${slotNum}`);
  const badge = document.getElementById(`slot-${slotNum}-badge`);
  const statusText = document.getElementById(`slot-${slotNum}-status-text`);
  const vehicleIcon = document.getElementById(`slot-${slotNum}-vehicle-icon`);
  const visualLabel = document.getElementById(`slot-${slotNum}-visual-label`);
  const irText = document.getElementById(`slot-${slotNum}-ir-text`);
  const ledText = document.getElementById(`slot-${slotNum}-led-text`);
  const actionContainer = document.getElementById(`slot-${slotNum}-action-container`);

  const status = slotData.status; // 'available' | 'reserved' | 'occupied'
  const isVehicle = slotData.vehicleDetected;
  const isReserved = slotData.reserved;

  // Reset Card Base Classes
  card.classList.remove('bay-available', 'bay-reserved', 'bay-occupied');
  badge.classList.remove('badge-available', 'badge-reserved', 'badge-occupied');

  // Update Hardware Telemetry
  irText.textContent = isVehicle ? 'Vehicle Detected' : 'No Vehicle (Clear)';
  irText.className = isVehicle ? 'font-bold text-rose-600 dark:text-rose-400' : 'font-bold text-gray-700 dark:text-gray-200';

  // Apply Status-specific Styles
  if (status === 'occupied') {
    card.classList.add('bay-occupied');
    badge.classList.add('badge-occupied');
    badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-rose-500 pulse-red"></span><span>🔴 OCCUPIED</span>`;
    
    vehicleIcon.textContent = '🚗';
    vehicleIcon.className = 'text-6xl transition-all duration-300 transform scale-110 animate-bounce';
    visualLabel.textContent = 'Vehicle Parked In Bay';
    visualLabel.className = 'mt-3 text-xs font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400';

    ledText.textContent = 'ON (Red)';
    ledText.className = 'font-bold text-rose-600 dark:text-rose-400';

    // Button Disabled
    actionContainer.innerHTML = `
      <button disabled class="w-full py-3.5 px-4 rounded-xl font-bold text-sm bg-gray-200 dark:bg-purple-950/80 text-gray-400 dark:text-gray-500 cursor-not-allowed flex items-center justify-center space-x-2 border border-purple-100 dark:border-purple-900/60">
        <span>NOT AVAILABLE</span>
        <span>🚫</span>
      </button>
    `;
  } else if (status === 'reserved') {
    card.classList.add('bay-reserved');
    badge.classList.add('badge-reserved');
    badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-500 pulse-yellow"></span><span>🟡 RESERVED</span>`;

    vehicleIcon.textContent = '🔒';
    vehicleIcon.className = 'text-6xl transition-all duration-300 transform scale-100 text-amber-500';
    visualLabel.textContent = 'Reserved via Website';
    visualLabel.className = 'mt-3 text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400';

    ledText.textContent = 'ON (Yellow)';
    ledText.className = 'font-bold text-amber-600 dark:text-amber-400';

    // Option to Cancel Reservation
    actionContainer.innerHTML = `
      <button onclick="cancelSlotReservation(${slotNum})" class="w-full py-3.5 px-4 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 shadow-md transition-all flex items-center justify-center space-x-2">
        <span>CANCEL RESERVATION</span>
        <span>✕</span>
      </button>
    `;
  } else {
    // Available
    card.classList.add('bay-available');
    badge.classList.add('badge-available');
    badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 pulse-green"></span><span>🟢 AVAILABLE</span>`;

    vehicleIcon.textContent = '🅿️';
    vehicleIcon.className = 'text-6xl transition-all duration-300 transform scale-100 text-emerald-500';
    visualLabel.textContent = 'Slot is Free & Clear';
    visualLabel.className = 'mt-3 text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400';

    ledText.textContent = 'OFF (Green)';
    ledText.className = 'font-bold text-emerald-600 dark:text-emerald-400';

    // Reserve Button
    actionContainer.innerHTML = `
      <button onclick="handleSlotAction(${slotNum})" class="w-full py-3.5 px-4 rounded-xl font-bold text-sm text-white gradient-purple-btn shadow-md transition-all flex items-center justify-center space-x-2">
        <span>RESERVE SLOT</span>
        <span>📅</span>
      </button>
    `;
  }
}

// ============================================================
// 7. Reservation & Cancellation Actions
// ============================================================
async function handleSlotAction(slotNum) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const res = await fetch('/api/parking/reserve', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        slot: slotNum,
        userId: currentUser ? currentUser.id : 1,
        userName: currentUser ? currentUser.name : 'Website User',
        userEmail: currentUser ? currentUser.email : 'user@parking.com'
      })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`Slot ${slotNum} Reserved Successfully!`, 'success');
      fetchParkingStatus();
      if (!tabContentReservations.classList.contains('hidden')) {
        fetchReservationsData();
      }
    } else {
      showToast(data.message || `Cannot reserve Slot ${slotNum}`, 'error');
    }
  } catch (err) {
    showToast('Failed to connect to backend server', 'error');
  }
}

async function cancelSlotReservation(slotNum) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const res = await fetch('/api/parking/cancel', {
      method: 'POST',
      headers,
      body: JSON.stringify({ slot: slotNum })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`Reservation cancelled for Slot ${slotNum}`, 'info');
      fetchParkingStatus();
      if (!tabContentReservations.classList.contains('hidden')) {
        fetchReservationsData();
      }
    } else {
      showToast(data.message || `Failed to cancel Slot ${slotNum}`, 'error');
    }
  } catch (err) {
    showToast('Failed to connect to backend server', 'error');
  }
}

// ============================================================
// 8. Tab 2: Parking Slot Management Table Data
// ============================================================
async function fetchSlotsData() {
  const tbody = document.getElementById('slots-table-body');
  try {
    const res = await fetch('/api/parking/slots');
    const data = await res.json();

    if (data.success && data.slots) {
      tbody.innerHTML = data.slots.map(s => {
        let badgeHtml = '';
        if (s.rawStatus === 'available') {
          badgeHtml = `<span class="badge-available px-3 py-1 rounded-full text-xs font-bold uppercase inline-flex items-center space-x-1.5"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span><span>🟢 Available</span></span>`;
        } else if (s.rawStatus === 'reserved') {
          badgeHtml = `<span class="badge-reserved px-3 py-1 rounded-full text-xs font-bold uppercase inline-flex items-center space-x-1.5"><span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span><span>🟡 Reserved</span></span>`;
        } else {
          badgeHtml = `<span class="badge-occupied px-3 py-1 rounded-full text-xs font-bold uppercase inline-flex items-center space-x-1.5"><span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span><span>🔴 Occupied</span></span>`;
        }

        return `
          <tr class="hover:bg-purple-50/50 dark:hover:bg-purple-950/30 transition-colors">
            <td class="py-4 px-4 sm:px-6 font-bold text-gray-500">${s.id}</td>
            <td class="py-4 px-4 sm:px-6 font-extrabold text-purple-700 dark:text-purple-300">${s.slotNumber}</td>
            <td class="py-4 px-4 sm:px-6">${badgeHtml}</td>
            <td class="py-4 px-4 sm:px-6 text-gray-700 dark:text-gray-300">${s.reserved}</td>
            <td class="py-4 px-4 sm:px-6 font-semibold ${s.isVehicleDetected ? 'text-rose-600 dark:text-rose-400' : 'text-gray-600 dark:text-gray-400'}">${s.vehicleDetected}</td>
            <td class="py-4 px-4 sm:px-6 font-mono text-xs font-bold text-purple-600 dark:text-purple-400">${s.ledStatus}</td>
            <td class="py-4 px-4 sm:px-6 text-xs text-gray-500 dark:text-gray-400">${s.updatedAt}</td>
          </tr>
        `;
      }).join('');
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-rose-500 font-semibold">Error loading slot data</td></tr>`;
  }
}

// ============================================================
// 9. Tab 3: Reservation Management Table Data
// ============================================================
async function fetchReservationsData() {
  const tbody = document.getElementById('reservations-table-body');
  try {
    const res = await fetch('/api/parking/reservations');
    const data = await res.json();

    if (data.success && data.reservations) {
      if (data.reservations.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-gray-400">No active or past reservations found.</td></tr>`;
        return;
      }

      tbody.innerHTML = data.reservations.map(r => {
        const isActive = r.rawStatus === 'active';
        const actionBtn = isActive
          ? `<button onclick="cancelSlotReservation(${r.slotNum})" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-500/20 text-amber-700 dark:text-amber-300 hover:bg-amber-500 hover:text-white transition-all">Cancel</button>`
          : `<span class="text-xs text-gray-400 dark:text-gray-500 italic">Completed</span>`;

        const statusBadge = isActive
          ? `<span class="badge-reserved px-2.5 py-1 rounded-full text-[11px] font-bold uppercase">Active</span>`
          : `<span class="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-500 dark:bg-purple-950/60 dark:text-gray-400">Cancelled</span>`;

        return `
          <tr class="hover:bg-purple-50/50 dark:hover:bg-purple-950/30 transition-colors">
            <td class="py-4 px-4 sm:px-6 font-bold text-gray-500">${r.id}</td>
            <td class="py-4 px-4 sm:px-6 font-extrabold text-purple-700 dark:text-purple-300">${r.slotNumber}</td>
            <td class="py-4 px-4 sm:px-6 text-gray-800 dark:text-gray-200">${r.user}</td>
            <td class="py-4 px-4 sm:px-6">${statusBadge}</td>
            <td class="py-4 px-4 sm:px-6 text-xs text-gray-600 dark:text-gray-300">${r.date}</td>
            <td class="py-4 px-4 sm:px-6 text-xs text-gray-600 dark:text-gray-300 font-mono">${r.time}</td>
            <td class="py-4 px-4 sm:px-6">${actionBtn}</td>
          </tr>
        `;
      }).join('');
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-rose-500 font-semibold">Error loading reservation data</td></tr>`;
  }
}

// ============================================================
// 10. Bootstrap App
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  initTheme();
  startISTClock();
  initTabs();

  // Initial Data Fetch
  fetchParkingStatus();

  // Real-time synchronization loop every 1.5 seconds
  pollingInterval = setInterval(fetchParkingStatus, 1500);
});
