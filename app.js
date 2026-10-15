/**
 * ব্লাড সেবা (Blood Seva) - Core Application Logic with Firebase Cloud Integration
 * Features:
 * - Firebase Firestore Real-time Cloud Synchronization (No LocalStorage dependency)
 * - Public Seeker Directory (No login needed, direct call for eligible donors)
 * - 90-Day Automatic Cooldown & Call Locking Mechanism
 * - Donor Account Registration with Admin Pending Approval Review
 * - Donor Dashboard with "আমি রক্ত দিয়েছি" (I Donated Blood) Trigger
 * - Admin Panel for Manual Donor Insertion, Reviewing, and Managing
 */

import { 
  isFirebaseConfigured, 
  subscribeToDonors, 
  saveDonorToCloud, 
  updateDonorInCloud, 
  deleteDonorFromCloud, 
  subscribeToAdmins,
  fetchAdminsFromCloud,
  saveAdminToCloud,
  updateAdminInCloud,
  deleteAdminFromCloud, 
  saveCustomFirebaseConfig, 
  clearCustomFirebaseConfig 
} from './firebase-config.js';

import {
  MASTER_ADMIN_PHONE,
  DEFAULT_MASTER_ADMIN_HASH,
  hashPassword,
  verifyUserPassword,
  verifyMasterAdminPassword,
  checkBruteForceLockout,
  recordFailedLoginAttempt,
  resetFailedLoginAttempts,
  sanitizeDonor,
  sanitizeDonorsList,
  validatePasswordStrength,
  normalizePhoneSalt
} from './security.js';

// 90 Days in Milliseconds: 90 days * 24 hrs * 60 mins * 60 secs * 1000 ms
const COOLDOWN_DURATION_MS = 90 * 24 * 60 * 60 * 1000;

// Local Session Keys (Only for maintaining who is logged into this browser)
const STORAGE_DONOR_AUTH_KEY = 'blood_seva_auth_donor_v1';
const STORAGE_ADMIN_AUTH_KEY = 'blood_seva_auth_admin_v1';
const STORAGE_DONORS_BACKUP_KEY = 'blood_seva_donors_backup_v1';
const STORAGE_ADMINS_BACKUP_KEY = 'blood_seva_admins_backup_v1';

// Bengali Number Converter Helper
function toBnNum(num) {
  const bnDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  return String(num).replace(/[0-9]/g, digit => bnDigits[digit]);
}

// Initial Seed Data (All passwords stored as irreversible cryptographic hashes!)
const INITIAL_SEED_DONORS = [
  {
    id: 'donor_001',
    name: 'তানভীর আহমেদ',
    bloodGroup: 'O+',
    phone: '01711000001',
    district: 'ঢাকা',
    area: 'মিরপুর-১০',
    passwordHash: '1c86e10e3d1dd004d629cd473af75ac832c374f32c3cf76073014071a79c5cf1',
    approvalStatus: 'APPROVED',
    lastDonationDate: null,
    cooldownUntil: 0,
    totalDonations: 4,
    registeredAt: '2026-08-10'
  },
  {
    id: 'donor_002',
    name: 'ফাহিম মোর্শেদ',
    bloodGroup: 'A+',
    phone: '01812000002',
    district: 'চট্টগ্রাম',
    area: 'জিইসি মোড়',
    passwordHash: 'ce23933b46ed4e3d87de830ac98cae6a6e0879382ce5625eecd0b57088e2d28b',
    approvalStatus: 'APPROVED',
    // Donated 20 days ago (so 70 days remaining in cooldown)
    lastDonationDate: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
    cooldownUntil: Date.now() + 70 * 24 * 60 * 60 * 1000,
    totalDonations: 6,
    registeredAt: '2026-07-15'
  },
  {
    id: 'donor_003',
    name: 'রাশেদুল করিম',
    bloodGroup: 'B+',
    phone: '01913000003',
    district: 'ঢাকা',
    area: 'ধানমন্ডি ২৭',
    passwordHash: '83270cfb8acf7bf3fddd2f1bd66926a1d595696eb64eb627d8d263bc362391fb',
    approvalStatus: 'APPROVED',
    lastDonationDate: null,
    cooldownUntil: 0,
    totalDonations: 2,
    registeredAt: '2026-09-01'
  },
  {
    id: 'donor_004',
    name: 'মীর সাদিকুল ইসলাম',
    bloodGroup: 'AB+',
    phone: '01614000004',
    district: 'সিলেট',
    area: 'জিন্দাবাজার',
    passwordHash: '2c2e26921aede439a178736445cb84c0e52b1ecbb7b141bc79919cf2390d7248',
    approvalStatus: 'APPROVED',
    lastDonationDate: null,
    cooldownUntil: 0,
    totalDonations: 5,
    registeredAt: '2026-08-22'
  },
  {
    id: 'donor_005',
    name: 'জাহিদুল হাসান',
    bloodGroup: 'O-',
    phone: '01715000005',
    district: 'রাজশাহী',
    area: 'জিরো পয়েন্ট',
    passwordHash: 'ec0d19ba7a04f19b8330407d46f0d88352fc68e07d7600488ae12f485f0cf481',
    approvalStatus: 'APPROVED',
    // Donated 45 days ago (so 45 days remaining in cooldown)
    lastDonationDate: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    cooldownUntil: Date.now() + 45 * 24 * 60 * 60 * 1000,
    totalDonations: 3,
    registeredAt: '2026-06-18'
  },
  {
    id: 'donor_006',
    name: 'মোঃ সাইদুর রহমান (পেন্ডিং)',
    bloodGroup: 'B+',
    phone: '01516000006',
    district: 'খুলনা',
    area: 'দৌলতপুর',
    passwordHash: '10e13737ee82effecc13e1865ecc0104b7d7420cc2070cea2bedc04a0afb33e1',
    approvalStatus: 'PENDING', // Awaiting Admin Review
    lastDonationDate: null,
    cooldownUntil: 0,
    totalDonations: 1,
    registeredAt: '2026-10-12'
  },
  {
    id: 'donor_007',
    name: 'নাজমুন নাহার স্মৃতি',
    bloodGroup: 'A-',
    phone: '01717000007',
    district: 'ঢাকা',
    area: 'উত্তরা সেক্টর ৭',
    passwordHash: 'c4899866c2bf82061386185b19b851e02f804f79a7d9a1cede862200a472b917',
    approvalStatus: 'APPROVED',
    lastDonationDate: null,
    cooldownUntil: 0,
    totalDonations: 2,
    registeredAt: '2026-09-10'
  }
];

// App State
const state = {
  donors: [],
  admins: [],
  currentDonor: null,
  currentAdmin: null,
  isAdmin: false,
  isMasterAdmin: false,
  currentView: 'public', // 'public', 'donor', 'admin'
  filters: {
    bloodGroup: 'ALL',
    district: 'ALL',
    status: 'AVAILABLE'
  },
  usingFirebase: false
};

// ==========================================================================
// Initialization & Cloud Sync
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  setupFirebaseConnection();
  restoreAuthSessions();
  renderPublicDonors();
  updateTopStats();
  updatePendingBadge();

  // Start real-time 1-second countdown loop
  setInterval(tickTimers, 1000);
});

function setupFirebaseConnection() {
  const indicator = document.getElementById('cloudStatusIndicator');
  const text = document.getElementById('cloudStatusText');

  if (isFirebaseConfigured()) {
    state.usingFirebase = true;
    if (indicator) indicator.className = 'cloud-indicator active';
    if (text) text.textContent = 'ফায়ারবেস ক্লাউড কানেক্টেড (রিয়েলটাইম সিঙ্ক সক্রিয়)';

    // Subscribe to Firestore Real-time updates for Donors
    subscribeToDonors((cloudDonors) => {
      console.log('🔥 Received Real-time Donors from Firebase:', cloudDonors.length);
      if (cloudDonors.length === 0) {
        // If Firestore is completely fresh and empty, seed it with initial donors
        seedInitialDonorsToCloud();
      } else {
        state.donors = cloudDonors;
        // Keep a sanitized local backup (passwords completely stripped out)
        localStorage.setItem(STORAGE_DONORS_BACKUP_KEY, JSON.stringify(sanitizeDonorsList(cloudDonors)));
        onDonorsUpdated();
      }
    }, (err) => {
      console.error('Firebase sync error:', err);
      showToast('ফায়ারবেস ডাটাবেস পারমিশন চেক করুন (Firestore Rules)', 'warning');
      fallbackToBackup();
    });

    // Admin synchronization is ONLY activated for authenticated admins (never downloaded by public visitors)
    syncAdminSubscription();
  } else {
    state.usingFirebase = false;
    if (indicator) indicator.className = 'cloud-indicator';
    if (text) text.textContent = 'ফায়ারবেস এখনও কনফিগার করা হয়নি। ক্লাউডে ডাটা সেভ করতে ফায়ারবেস সেটিংস এ ক্লিক করুন।';
    fallbackToBackup();
    fallbackAdminsBackup();
  }
}

let adminUnsubscribe = null;
function syncAdminSubscription() {
  if (!state.usingFirebase) return;
  if (state.isAdmin) {
    if (!adminUnsubscribe) {
      adminUnsubscribe = subscribeToAdmins((cloudAdmins) => {
        console.log('🔥 Received Real-time Admins from Firebase:', cloudAdmins.length);
        state.admins = cloudAdmins;
        localStorage.setItem(STORAGE_ADMINS_BACKUP_KEY, JSON.stringify(cloudAdmins));
        if (state.currentView === 'admin' && state.isMasterAdmin) {
          renderAdminTeam();
        }
      }, (err) => {
        console.error('Firebase admins sync error:', err);
        fallbackAdminsBackup();
      });
    }
  } else {
    if (typeof adminUnsubscribe === 'function') {
      try { adminUnsubscribe(); } catch(e) {}
    }
    adminUnsubscribe = null;
    state.admins = [];
    localStorage.removeItem(STORAGE_ADMINS_BACKUP_KEY);
  }
}

function fallbackAdminsBackup() {
  const backup = localStorage.getItem(STORAGE_ADMINS_BACKUP_KEY);
  if (backup) {
    try {
      state.admins = JSON.parse(backup);
    } catch (e) {
      state.admins = [];
    }
  } else {
    state.admins = [];
  }
}

function fallbackToBackup() {
  const backup = localStorage.getItem(STORAGE_DONORS_BACKUP_KEY);
  if (backup) {
    try {
      state.donors = JSON.parse(backup);
    } catch (e) {
      state.donors = INITIAL_SEED_DONORS;
    }
  } else {
    state.donors = INITIAL_SEED_DONORS;
  }
  onDonorsUpdated();
}

async function seedInitialDonorsToCloud() {
  console.log('Seeding initial donors into Firestore...');
  for (const donor of INITIAL_SEED_DONORS) {
    try {
      await saveDonorToCloud(donor);
    } catch (err) {
      console.warn('Seeding item failed:', err);
    }
  }
}

function onDonorsUpdated() {
  renderPublicDonors();
  updateTopStats();
  updatePendingBadge();

  if (state.currentView === 'admin') {
    renderAdminPanel();
  }

  // Update current donor object if logged in
  if (state.currentDonor) {
    const updatedSelf = state.donors.find(d => d.id === state.currentDonor.id);
    if (updatedSelf) {
      state.currentDonor = updatedSelf;
      if (state.currentView === 'donor') {
        renderDonorDashboard();
      }
    }
  }
}

const STORAGE_AUTH_SESSION_KEY = 'blood_seva_active_session_v2';

function updateNavbarAuth() {
  const btnLogin = document.getElementById('navBtnLogin');
  const btnPortal = document.getElementById('navBtnPortal');
  const portalLabel = document.getElementById('portalNavLabel');
  const btnLogout = document.getElementById('navBtnLogout');

  // Mobile navigation elements
  const mobPortalLabel = document.getElementById('mobPortalLabel');
  const mobTopLogout = document.getElementById('mobTopLogout');
  const mobPortalIcon = document.getElementById('mobNavPortalIcon');

  if (state.isAdmin) {
    if (btnLogin) btnLogin.style.display = 'none';
    if (btnPortal) {
      btnPortal.style.display = 'inline-flex';
      btnPortal.classList.toggle('active', state.currentView === 'admin');
    }
    const adminLabel = state.isMasterAdmin 
      ? 'মাস্টার এডমিন' 
      : (state.currentAdmin?.name ? state.currentAdmin.name.split(' ')[0] + ' (এডমিন)' : 'এডমিন প্যানেল');
    if (portalLabel) portalLabel.textContent = adminLabel;
    if (btnLogout) btnLogout.style.display = 'inline-flex';

    if (mobPortalLabel) mobPortalLabel.textContent = 'এডমিন';
    if (mobTopLogout) mobTopLogout.style.display = 'inline-flex';
    if (mobPortalIcon) {
      mobPortalIcon.innerHTML = '<path d="M12 2a5 5 0 0 1 5 5v3a5 5 0 0 1-10 0V7a5 5 0 0 1 5-5z"></path><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>';
    }
  } else if (state.currentDonor) {
    if (btnLogin) btnLogin.style.display = 'none';
    if (btnPortal) {
      btnPortal.style.display = 'inline-flex';
      btnPortal.classList.toggle('active', state.currentView === 'donor');
    }
    if (portalLabel) portalLabel.textContent = state.currentDonor.name.split(' ')[0] + ' (ড্যাশবোর্ড)';
    if (btnLogout) btnLogout.style.display = 'inline-flex';

    if (mobPortalLabel) mobPortalLabel.textContent = 'ড্যাশবোর্ড';
    if (mobTopLogout) mobTopLogout.style.display = 'inline-flex';
    if (mobPortalIcon) {
      mobPortalIcon.innerHTML = '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>';
    }
  } else {
    if (btnLogin) btnLogin.style.display = 'inline-flex';
    if (btnPortal) btnPortal.style.display = 'none';
    if (btnLogout) btnLogout.style.display = 'none';

    if (mobPortalLabel) mobPortalLabel.textContent = 'লগইন';
    if (mobTopLogout) mobTopLogout.style.display = 'none';
    if (mobPortalIcon) {
      mobPortalIcon.innerHTML = '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line>';
    }
  }

  const btnMasterPass = document.getElementById('btnMasterChangePass');
  if (btnMasterPass) {
    btnMasterPass.style.display = (state.isAdmin && state.isMasterAdmin) ? 'inline-flex' : 'none';
  }

  updateMobileBottomNavActive();
}

function updateMobileBottomNavActive() {
  const mobPublic = document.getElementById('mobNavPublic');
  const mobPortal = document.getElementById('mobNavPortal');

  if (mobPublic) mobPublic.classList.toggle('active', state.currentView === 'public');
  if (mobPortal) mobPortal.classList.toggle('active', state.currentView === 'donor' || state.currentView === 'admin');
}

function handleMobileAuthClick() {
  if (state.isAdmin) {
    switchView('admin');
  } else if (state.currentDonor) {
    switchView('donor');
  } else {
    openUnifiedLoginModal();
  }
}

function restoreAuthSessions() {
  const sessionRaw = localStorage.getItem(STORAGE_AUTH_SESSION_KEY);
  if (sessionRaw) {
    try {
      const session = JSON.parse(sessionRaw);
      if (session.role === 'ADMIN') {
        state.isAdmin = true;
        state.isMasterAdmin = !!session.isMaster;
        state.currentAdmin = session;
        state.currentDonor = null;
      } else if (session.role === 'DONOR' && session.id) {
        const found = state.donors.find(d => d.id === session.id);
        if (found) {
          state.currentDonor = found;
          state.isAdmin = false;
          state.isMasterAdmin = false;
        }
      }
    } catch (e) {
      console.warn('Session parse error:', e);
    }
  }
  updateNavbarAuth();
}

// ==========================================================================
// Cooldown Calculation Helpers
// ==========================================================================
function isDonorInCooldown(donor) {
  if (!donor.cooldownUntil) return false;
  return Number(donor.cooldownUntil) > Date.now();
}

function getRemainingCooldownTime(cooldownUntil) {
  const diffMs = Math.max(0, Number(cooldownUntil) - Date.now());
  const totalSeconds = Math.floor(diffMs / 1000);

  const days = Math.floor(totalSeconds / (3600 * 24));
  const hours = Math.floor((totalSeconds % (3600 * 24)) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  return { diffMs, totalSeconds, days, hours, minutes, seconds };
}

function formatCooldownDisplayBn(cooldownUntil) {
  const { days, hours, minutes, seconds } = getRemainingCooldownTime(cooldownUntil);
  if (days > 0) {
    return `${toBnNum(days)} দিন ${toBnNum(hours)} ঘণ্টা ${toBnNum(minutes)} মিনিট`;
  }
  return `${toBnNum(hours)} ঘণ্টা ${toBnNum(minutes)} মিনিট ${toBnNum(seconds)} সেকেন্ড`;
}

// ==========================================================================
// ==========================================================================
// Public View: Donor Directory & Filtering
// ==========================================================================
function updateQuickBloodChipsUI(activeGroup) {
  const chips = document.querySelectorAll('.blood-chip');
  chips.forEach(chip => {
    if (chip.getAttribute('data-group') === activeGroup) {
      chip.classList.add('active');
    } else {
      chip.classList.remove('active');
    }
  });
}

function selectQuickBloodGroup(group) {
  const selectElem = document.getElementById('filterBloodGroup');
  if (selectElem) {
    selectElem.value = group;
  }
  state.filters.bloodGroup = group;
  updateQuickBloodChipsUI(group);
  renderPublicDonors();
}

function applyFilters() {
  const selectedGroup = document.getElementById('filterBloodGroup').value;
  state.filters.bloodGroup = selectedGroup;
  state.filters.district = document.getElementById('filterDistrict').value;
  state.filters.status = document.getElementById('filterStatus').value;
  updateQuickBloodChipsUI(selectedGroup);
  renderPublicDonors();
}

function resetFilters() {
  document.getElementById('filterBloodGroup').value = 'ALL';
  document.getElementById('filterDistrict').value = 'ALL';
  document.getElementById('filterStatus').value = 'ALL';
  state.filters = { bloodGroup: 'ALL', district: 'ALL', status: 'ALL' };
  updateQuickBloodChipsUI('ALL');
  renderPublicDonors();
  showToast('ফিল্টার রিসেট করা হয়েছে', 'info');
}

function renderPublicDonors() {
  const grid = document.getElementById('donorsGrid');
  const emptyState = document.getElementById('noDonorsState');
  const notice = document.getElementById('donorCountNotice');

  // Filter ONLY Approved Donors for public view!
  let list = state.donors.filter(d => d.approvalStatus === 'APPROVED');

  if (state.filters.bloodGroup !== 'ALL') {
    list = list.filter(d => d.bloodGroup === state.filters.bloodGroup);
  }

  if (state.filters.district !== 'ALL') {
    list = list.filter(d => d.district === state.filters.district);
  }

  if (state.filters.status === 'AVAILABLE') {
    list = list.filter(d => !isDonorInCooldown(d));
  } else if (state.filters.status === 'COOLDOWN') {
    list = list.filter(d => isDonorInCooldown(d));
  }

  // Sort: যারা এখন ব্লাড দিতে পারবেন তারা আগে থাকবে, যারা দিতে পারবেন না (বিশ্রামে আছেন) তারা পরে থাকবে
  list.sort((a, b) => {
    const aCooldown = isDonorInCooldown(a);
    const bCooldown = isDonorInCooldown(b);

    if (aCooldown !== bCooldown) {
      // aCooldown false (ready) comes before bCooldown true (not ready)
      return aCooldown ? 1 : -1;
    }

    // If both in cooldown, the donor whose cooldown finishes sooner appears first
    if (aCooldown && bCooldown) {
      return (Number(a.cooldownUntil) || 0) - (Number(b.cooldownUntil) || 0);
    }

    // If both are ready, sort by total donations descending
    return (b.totalDonations || 0) - (a.totalDonations || 0);
  });

  if (list.length === 0) {
    grid.innerHTML = '';
    emptyState.style.display = 'block';
    notice.textContent = 'কোনো ডোনার পাওয়া যায়নি';
    return;
  }

  emptyState.style.display = 'none';
  notice.textContent = `মোট ${toBnNum(list.length)} জন রক্তদাতা প্রদর্শিত হচ্ছে`;

  grid.innerHTML = list.map(donor => {
    const inCooldown = isDonorInCooldown(donor);
    const lastDonationStr = donor.lastDonationDate 
      ? new Date(donor.lastDonationDate).toLocaleDateString('bn-BD', { year: 'numeric', month: 'long', day: 'numeric' })
      : 'রেকর্ড নেই';

    return `
      <div class="donor-card" id="card-${donor.id}">
        <div class="donor-card-top">
          <div class="donor-badge-group">${donor.bloodGroup}</div>
          <div class="donor-card-heading">
            <h3 class="donor-card-name">${donor.name}</h3>
            <div class="donor-card-location">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8z"></path><circle cx="12" cy="10" r="3"></circle></svg>
              <span>${donor.district}, ${donor.area}</span>
            </div>
          </div>
        </div>

        <div>
          ${inCooldown ? `
            <div class="status-pill cooldown">
              <span class="pill-dot"></span>
              <span>বিশ্রামে আছেন (৯০ দিনের কাউন্টডাউন)</span>
            </div>
            <div class="cooldown-card-notice">
              <div class="cooldown-notice-header">
                <span>⏳ রক্তদানের পর বিশ্রাম সময় বাকি:</span>
              </div>
              <div class="cooldown-timer-text" data-timer-id="${donor.id}" data-cooldown="${donor.cooldownUntil}">
                ${formatCooldownDisplayBn(donor.cooldownUntil)}
              </div>
            </div>
          ` : `
            <div class="status-pill available">
              <span class="pill-dot"></span>
              <span>রক্তদানে প্রস্তুত (সরাসরি কলযোগ্য)</span>
            </div>
          `}
        </div>

        <div class="donor-card-meta">
          <div>মোট দান: <strong>${toBnNum(donor.totalDonations || 0)} বার</strong></div>
          <div>শেষ রক্তদান: <strong>${lastDonationStr}</strong></div>
        </div>

        <div class="donor-card-action">
          ${inCooldown ? `
            <button class="btn-call-locked" onclick="alertLockedDonor('${donor.name}', ${donor.cooldownUntil})">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
              <span>কল লক রয়েছে (বিশ্রামে আছেন)</span>
            </button>
          ` : `
            <a href="tel:${donor.phone}" class="btn-call-active" onclick="recordCallAttempt('${donor.name}', '${donor.phone}')">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
              <span>সরাসরি কল করুন (${donor.phone})</span>
            </a>
          `}
        </div>
      </div>
    `;
  }).join('');
}

function alertLockedDonor(name, cooldownUntil) {
  const remainingStr = formatCooldownDisplayBn(cooldownUntil);
  alert(`🛡️ এই ডোনার (${name}) সম্প্রতি রক্ত দিয়েছেন এবং তার স্বাস্থ্য সুরক্ষার জন্য বিশ্রামে আছেন।\n\nআগামী ${remainingStr} পর্যন্ত তার কল বন্ধ রাখা হয়েছে। অনুগ্রহ করে তালিকার অন্য একজন প্রস্তুত ডোনারকে কল করুন।`);
}

function recordCallAttempt(name, phone) {
  showToast(`${name}-এর নম্বরে (${phone}) কল ডায়াল করা হচ্ছে...`, 'info');
}

function updateTopStats() {
  const approved = state.donors.filter(d => d.approvalStatus === 'APPROVED');
  const ready = approved.filter(d => !isDonorInCooldown(d)).length;
  const cooldown = approved.filter(d => isDonorInCooldown(d)).length;

  const elReady = document.getElementById('statReadyCount');
  const elCooldown = document.getElementById('statCooldownCount');
  const elTotal = document.getElementById('statTotalApproved');

  if (elReady) elReady.textContent = toBnNum(ready);
  if (elCooldown) elCooldown.textContent = toBnNum(cooldown);
  if (elTotal) elTotal.textContent = toBnNum(approved.length);
}

function updatePendingBadge() {
  const pending = state.donors.filter(d => d.approvalStatus === 'PENDING').length;
  const pill = document.getElementById('pendingPillCount');
  const mobPill = document.getElementById('mobPendingPill');

  if (pending > 0) {
    if (pill) {
      pill.style.display = 'inline-block';
      pill.textContent = toBnNum(pending);
    }
    if (mobPill && state.isAdmin) {
      mobPill.style.display = 'inline-block';
      mobPill.textContent = toBnNum(pending);
    }
  } else {
    if (pill) pill.style.display = 'none';
    if (mobPill) mobPill.style.display = 'none';
  }
}

// Realtime countdown ticker every 1 second
function tickTimers() {
  const timerElements = document.querySelectorAll('[data-timer-id]');
  timerElements.forEach(el => {
    const cooldownUntil = Number(el.getAttribute('data-cooldown'));
    if (cooldownUntil > Date.now()) {
      el.textContent = formatCooldownDisplayBn(cooldownUntil);
    } else {
      renderPublicDonors();
      updateTopStats();
    }
  });

  if (state.currentDonor && isDonorInCooldown(state.currentDonor)) {
    const { totalSeconds, days, hours, minutes, seconds } = getRemainingCooldownTime(state.currentDonor.cooldownUntil);
    if (totalSeconds > 0) {
      document.getElementById('timerDays').textContent = String(days).padStart(2, '0');
      document.getElementById('timerHours').textContent = String(hours).padStart(2, '0');
      document.getElementById('timerMinutes').textContent = String(minutes).padStart(2, '0');
      document.getElementById('timerSeconds').textContent = String(seconds).padStart(2, '0');
    } else {
      renderDonorDashboard();
      updateTopStats();
    }
  }
}

// ==========================================================================
// View Switcher (Public, Donor Dashboard, Admin)
// ==========================================================================
function switchView(viewName) {
  state.currentView = viewName;

  document.getElementById('publicView').style.display = viewName === 'public' ? 'block' : 'none';
  document.getElementById('donorDashboardView').style.display = viewName === 'donor' ? 'block' : 'none';
  document.getElementById('adminView').style.display = viewName === 'admin' ? 'block' : 'none';

  const navPublic = document.getElementById('navBtnPublic');
  if (navPublic) navPublic.classList.toggle('active', viewName === 'public');
  updateNavbarAuth();

  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (viewName === 'public') {
    renderPublicDonors();
    updateTopStats();
  } else if (viewName === 'admin') {
    renderAdminPanel();
  }
}

// ==========================================================================
// Unified Portal & Login System (Single Login for Admin & Donors)
// ==========================================================================
function openUnifiedLoginModal() {
  const form = document.getElementById('unifiedLoginForm');
  if (form) form.reset();
  const phone = document.getElementById('loginPhone');
  if (phone) phone.value = '';
  const pass = document.getElementById('loginPassword');
  if (pass) {
    pass.value = '';
    pass.type = 'password';
  }

  // Check brute force lockout state
  const lockout = checkBruteForceLockout();
  const lockoutContainer = document.getElementById('loginLockoutContainer');
  const lockoutMsg = document.getElementById('loginLockoutMsg');
  const submitBtn = document.getElementById('btnUnifiedLoginSubmit');

  if (lockout.isLocked) {
    if (lockoutContainer) lockoutContainer.style.display = 'flex';
    if (lockoutMsg) lockoutMsg.textContent = `❌ অতিরিক্ত ভুল চেষ্টার কারণে লগইন সাময়িকভাবে লক রয়েছে। অনুগ্রহ করে ${toBnNum(lockout.remainingSec)} সেকেন্ড অপেক্ষা করুন।`;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = `লক রয়েছে (${toBnNum(lockout.remainingSec)} সেঃ)`;
    }
  } else {
    if (lockoutContainer) lockoutContainer.style.display = 'none';
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'লগইন করুন';
    }
  }

  openModal('unifiedLoginModal');
}

function openCurrentPortal() {
  if (state.isAdmin) {
    switchView('admin');
  } else if (state.currentDonor) {
    switchView('donor');
    renderDonorDashboard();
  } else {
    openUnifiedLoginModal();
  }
}

function openRegisterModal() {
  openModal('registerModal');
}

function openRegisterFromLogin() {
  closeModal('unifiedLoginModal');
  openModal('registerModal');
}

async function handleUnifiedLogin(e) {
  e.preventDefault();

  // 1. Check brute force lockout
  const lockout = checkBruteForceLockout();
  if (lockout.isLocked) {
    alert(`❌ অতিরিক্ত ভুল চেষ্টার কারণে লগইন সাময়িকভাবে বন্ধ আছে। হ্যাকিং ও অননুমোদিত চেষ্টা প্রতিরোধের জন্য অনুগ্রহ করে ${toBnNum(lockout.remainingSec)} সেকেন্ড পর আবার চেষ্টা করুন।`);
    return;
  }

  const phone = document.getElementById('loginPhone').value.trim();
  const password = document.getElementById('loginPassword').value.trim();
  const cleanPhone = normalizePhoneSalt(phone);

  if (!phone || !password) {
    alert('অনুগ্রহ করে মোবাইল নম্বর ও পাসওয়ার্ড দিন।');
    return;
  }

  const submitBtn = document.getElementById('btnUnifiedLoginSubmit');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'যাচাই করা হচ্ছে...';
  }

  try {
    // 1. Check if Master Admin (Cryptographic Salted Hash Verification)
    const isMasterLogin = await verifyMasterAdminPassword(cleanPhone, password);
    if (isMasterLogin) {
      resetFailedLoginAttempts();
      state.isAdmin = true;
      state.isMasterAdmin = true;
      state.currentAdmin = { name: 'মাস্টার এডমিন', phone: MASTER_ADMIN_PHONE, role: 'MASTER_ADMIN' };
      state.currentDonor = null;
      localStorage.setItem(STORAGE_AUTH_SESSION_KEY, JSON.stringify({ role: 'ADMIN', isMaster: true, phone: MASTER_ADMIN_PHONE }));

      syncAdminSubscription();
      closeModal('unifiedLoginModal');
      const form = document.getElementById('unifiedLoginForm');
      if (form) form.reset();

      updateNavbarAuth();
      switchView('admin');
      showToast('👑 স্বাগতম মাস্টার এডমিন! এডমিন প্যানেলে সফলভাবে প্রবেশ করেছেন।', 'success');
      return;
    }

    // 2. Check if Added Sub-Admin
    let adminList = state.admins;
    if ((!adminList || adminList.length === 0) && state.usingFirebase) {
      adminList = await fetchAdminsFromCloud();
    }

    const foundAdmin = adminList.find(a => {
      const aClean = normalizePhoneSalt(a.phone);
      return aClean === cleanPhone || a.phone === phone;
    });

    if (foundAdmin) {
      const isAdminMatch = await verifyUserPassword(password, foundAdmin, async (newHash) => {
        // Automatically upgrade legacy plaintext to secure hash in cloud
        if (state.usingFirebase) {
          await updateAdminInCloud(foundAdmin.id, { passwordHash: newHash, password: null });
        }
      });

      if (isAdminMatch) {
        resetFailedLoginAttempts();
        state.isAdmin = true;
        state.isMasterAdmin = false;
        state.currentAdmin = foundAdmin;
        state.currentDonor = null;
        localStorage.setItem(STORAGE_AUTH_SESSION_KEY, JSON.stringify({ role: 'ADMIN', isMaster: false, phone: foundAdmin.phone, name: foundAdmin.name }));

        syncAdminSubscription();
        closeModal('unifiedLoginModal');
        const form = document.getElementById('unifiedLoginForm');
        if (form) form.reset();

        updateNavbarAuth();
        switchView('admin');
        showToast(`স্বাগতম ${foundAdmin.name}! এডমিন প্যানেলে প্রবেশ করেছেন।`, 'success');
        return;
      }
    }

    // 3. Check if Donor credentials
    const foundDonor = state.donors.find(d => {
      const dClean = normalizePhoneSalt(d.phone);
      return dClean === cleanPhone || d.phone === phone;
    });

    if (foundDonor) {
      const isDonorMatch = await verifyUserPassword(password, foundDonor, async (newHash) => {
        // Automatically upgrade legacy plaintext to secure hash in cloud
        if (state.usingFirebase) {
          await updateDonorInCloud(foundDonor.id, { passwordHash: newHash, password: null });
        }
      });

      if (isDonorMatch) {
        resetFailedLoginAttempts();
        state.currentDonor = foundDonor;
        state.isAdmin = false;
        state.isMasterAdmin = false;
        state.currentAdmin = null;
        localStorage.setItem(STORAGE_AUTH_SESSION_KEY, JSON.stringify({ role: 'DONOR', id: foundDonor.id }));

        closeModal('unifiedLoginModal');
        const form = document.getElementById('unifiedLoginForm');
        if (form) form.reset();

        updateNavbarAuth();
        switchView('donor');
        renderDonorDashboard();
        showToast(`স্বাগতম, ${foundDonor.name}! আপনার ড্যাশবোর্ডে প্রবেশ করেছেন।`, 'success');
        return;
      }
    }

    // 4. Failed login - Record attempt & trigger lockout protection
    const attemptResult = recordFailedLoginAttempt();
    if (attemptResult.lockedNow) {
      alert(`❌ অতিরিক্ত ৫ বার ভুল পাসওয়ার্ড দেওয়ার কারণে আপনার লগইন ৬০ সেকেন্ডের জন্য সাময়িকভাবে লক করা হয়েছে। হ্যাকিং প্রতিরোধে এটি স্বয়ংক্রিয় নিরাপত্তা ব্যবস্থা।`);
      openUnifiedLoginModal();
    } else {
      alert(`ভুল মোবাইল নম্বর অথবা পাসওয়ার্ড! আপনার আর ${toBnNum(attemptResult.remainingAttempts)} বার চেষ্টা করার সুযোগ আছে।`);
    }

  } catch (err) {
    console.error('Login error:', err);
    alert('লগইন প্রক্রিয়ায় সমস্যা হয়েছে: ' + err.message);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'লগইন করুন';
    }
  }
}

function handleLogout() {
  state.isAdmin = false;
  state.isMasterAdmin = false;
  state.currentAdmin = null;
  state.currentDonor = null;
  localStorage.removeItem(STORAGE_AUTH_SESSION_KEY);
  syncAdminSubscription();
  updateNavbarAuth();
  switchView('public');
  showToast('সফলভাবে লগআউট হয়েছেন।', 'info');
}

async function handleDonorRegister(e) {
  e.preventDefault();

  const name = document.getElementById('regName').value.trim();
  const bloodGroup = document.getElementById('regBloodGroup').value;
  const phone = document.getElementById('regPhone').value.trim();
  const district = document.getElementById('regDistrict').value;
  const area = document.getElementById('regArea').value.trim();
  const lastDonationInput = document.getElementById('regLastDonation').value;
  const password = document.getElementById('regPassword').value;

  const strength = validatePasswordStrength(password);
  if (!strength.valid) {
    alert(strength.message);
    return;
  }

  const cleanPhone = normalizePhoneSalt(phone);
  const existing = state.donors.find(d => normalizePhoneSalt(d.phone) === cleanPhone);
  if (existing) {
    alert('এই মোবাইল নম্বর দিয়ে ইতিমধ্যে একটি একাউন্ট রয়েছে!');
    return;
  }

  let cooldownUntil = 0;
  let lastDonationDate = null;

  if (lastDonationInput) {
    const donationDateMs = new Date(lastDonationInput).getTime();
    lastDonationDate = new Date(lastDonationInput).toISOString();
    const calculatedCooldown = donationDateMs + COOLDOWN_DURATION_MS;
    if (calculatedCooldown > Date.now()) {
      cooldownUntil = calculatedCooldown;
    }
  }

  // Generate Salted Cryptographic SHA-256 Hash - NEVER store plain text password!
  const passwordHash = await hashPassword(password, cleanPhone);

  const newDonor = {
    id: 'donor_' + Date.now(),
    name,
    bloodGroup,
    phone,
    district,
    area,
    passwordHash, // Cryptographically secured!
    approvalStatus: 'PENDING', // Awaiting Admin Approval
    lastDonationDate,
    cooldownUntil,
    totalDonations: lastDonationDate ? 1 : 0,
    registeredAt: new Date().toISOString().split('T')[0]
  };

  try {
    if (state.usingFirebase) {
      await saveDonorToCloud(newDonor);
    } else {
      state.donors.unshift(newDonor);
      localStorage.setItem(STORAGE_DONORS_BACKUP_KEY, JSON.stringify(sanitizeDonorsList(state.donors)));
      onDonorsUpdated();
    }

    closeModal('registerModal');
    document.getElementById('donorRegisterForm').reset();

    state.currentDonor = newDonor;
    state.isAdmin = false;
    localStorage.setItem(STORAGE_AUTH_SESSION_KEY, JSON.stringify({ role: 'DONOR', id: newDonor.id }));
    updateNavbarAuth();

    switchView('donor');
    renderDonorDashboard();
    showToast('আপনার রেজিস্ট্রেশন ক্লাউডে জমা হয়েছে! পাসওয়ার্ড সম্পূর্ণ এনক্রিপ্ট করে সুরক্ষিত রাখা হয়েছে।', 'success');
  } catch (err) {
    console.error('Registration failed:', err);
    alert('রেজিস্ট্রেশন করতে সমস্যা হয়েছে: ' + err.message);
  }
}

function renderDonorDashboard() {
  const donor = state.currentDonor;
  if (!donor) return;

  document.getElementById('dashAvatarGroup').textContent = donor.bloodGroup;
  document.getElementById('dashDonorName').textContent = donor.name;
  document.getElementById('dashDonorPhone').textContent = '📱 ' + donor.phone;
  document.getElementById('dashDonorCity').textContent = `📍 ${donor.district}, ${donor.area}`;

  const approvalPill = document.getElementById('dashApprovalStatus');
  const pendingWarning = document.getElementById('dashPendingWarning');

  if (donor.approvalStatus === 'APPROVED') {
    approvalPill.textContent = 'অনুমোদিত ডোনার (ক্লাউড অ্যাক্টিভ)';
    approvalPill.className = 'tag status-pill available';
    pendingWarning.style.display = 'none';
  } else if (donor.approvalStatus === 'PENDING') {
    approvalPill.textContent = 'অ্যাডমিন রিভিউ চলছে (পেন্ডিং)';
    approvalPill.className = 'tag status-pill pending';
    pendingWarning.style.display = 'flex';
  } else {
    approvalPill.textContent = 'বাতিলকৃত প্রোফাইল';
    approvalPill.className = 'tag status-pill cooldown';
    pendingWarning.style.display = 'none';
  }

  const inCooldown = isDonorInCooldown(donor);
  const banner = document.getElementById('dashCooldownBanner');
  const timerBox = document.getElementById('dashLiveTimerBox');
  const btnMarkDonated = document.getElementById('btnMarkDonated');

  if (inCooldown) {
    banner.innerHTML = `
      <div style="color: #c2410c; font-weight: 600; display: flex; align-items: center; gap: 0.5rem;">
        <span class="pill-dot" style="background:#f59e0b;"></span>
        <span>আপনি বর্তমানে বিশ্রামে আছেন (৯০ দিনের কুলডাউন সক্রিয়)। আপনার কল লক রয়েছে।</span>
      </div>
    `;
    timerBox.style.display = 'block';
    btnMarkDonated.innerHTML = `<span>রক্তদানের তারিখ আপডেট করুন</span>`;
  } else {
    banner.innerHTML = `
      <div style="color: #065f46; font-weight: 600; display: flex; align-items: center; gap: 0.5rem;">
        <span class="pill-dot" style="background:#10b981;"></span>
        <span>আপনি রক্তদানের জন্য সম্পূর্ণ প্রস্তুত ও সুস্থ আছেন। কল সক্রিয়।</span>
      </div>
    `;
    timerBox.style.display = 'none';
    btnMarkDonated.innerHTML = `
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path></svg>
      <span>আমি রক্ত দিয়েছি</span>
    `;
  }

  document.getElementById('dashTotalDonations').textContent = toBnNum(donor.totalDonations || 0) + ' বার';
  document.getElementById('dashLivesSaved').textContent = toBnNum(donor.totalDonations || 0) + ' জন';
  
  const lastStr = donor.lastDonationDate 
    ? new Date(donor.lastDonationDate).toLocaleDateString('bn-BD', { year: 'numeric', month: 'long', day: 'numeric' })
    : 'এখনো রক্ত দেননি';
  document.getElementById('dashLastDonationDate').textContent = lastStr;
}

// "আমি রক্ত দিয়েছি" Core Feature
function confirmMarkDonated() {
  openModal('confirmDonatedModal');
}

async function executeMarkDonated() {
  if (!state.currentDonor) return;

  const now = Date.now();
  const updates = {
    lastDonationDate: new Date().toISOString(),
    cooldownUntil: now + COOLDOWN_DURATION_MS,
    totalDonations: (state.currentDonor.totalDonations || 0) + 1
  };

  try {
    if (state.usingFirebase) {
      await updateDonorInCloud(state.currentDonor.id, updates);
    } else {
      Object.assign(state.currentDonor, updates);
      const idx = state.donors.findIndex(d => d.id === state.currentDonor.id);
      if (idx !== -1) state.donors[idx] = state.currentDonor;
      localStorage.setItem(STORAGE_DONORS_BACKUP_KEY, JSON.stringify(state.donors));
      onDonorsUpdated();
    }

    closeModal('confirmDonatedModal');
    renderDonorDashboard();
    showToast('রক্তদানের তথ্য ক্লাউডে সফলভাবে সেভ হয়েছে! আগামী ৯০ দিন কল লক থাকবে।', 'success');
  } catch (err) {
    console.error('Update cooldown failed:', err);
    alert('আপডেট ব্যর্থ হয়েছে: ' + err.message);
  }
}

// ==========================================================================
// Admin Panel Logic (Cloud-Integrated)
// ==========================================================================
function renderAdminPanel() {
  const pending = state.donors.filter(d => d.approvalStatus === 'PENDING');
  const approved = state.donors.filter(d => d.approvalStatus === 'APPROVED');
  const cooldown = approved.filter(d => isDonorInCooldown(d));

  document.getElementById('adminStatPending').textContent = toBnNum(pending.length);
  document.getElementById('adminStatApproved').textContent = toBnNum(approved.length);
  document.getElementById('adminStatCooldown').textContent = toBnNum(cooldown.length);
  document.getElementById('adminStatTotal').textContent = toBnNum(state.donors.length);
  document.getElementById('tablePendingCount').textContent = `${toBnNum(pending.length)} জন পেন্ডিং`;

  const pendingBody = document.getElementById('pendingDonorsTableBody');
  if (pending.length === 0) {
    pendingBody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 2rem; color: #64748b;">
          কোনো পেন্ডিং রেজিস্ট্রেশন নেই। ফায়ারবেসে নতুন ডোনার রেজিস্ট্রেশন করলে তাৎক্ষণিক এখানে আসবে।
        </td>
      </tr>
    `;
  } else {
    pendingBody.innerHTML = pending.map(donor => `
      <tr>
        <td><strong>${donor.name}</strong></td>
        <td><span class="donor-cell-group">${donor.bloodGroup}</span></td>
        <td>${donor.phone}</td>
        <td>${donor.district}, ${donor.area}</td>
        <td>${donor.registeredAt || 'আজ'}</td>
        <td><span class="status-pill pending">রিভিউ প্রয়োজন</span></td>
        <td>
          <div class="action-btns-wrap">
            <button class="btn-table-action approve" onclick="adminApproveDonor('${donor.id}')">
              ✅ অনুমোদন (Approve)
            </button>
            <button class="btn-table-action reject" onclick="adminRejectDonor('${donor.id}')">
              ❌ বাতিল (Reject)
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  renderApprovedDonorsTable(approved);

  // Master Admin Section visibility
  const masterSection = document.getElementById('masterAdminSection');
  if (masterSection) {
    if (state.isMasterAdmin) {
      masterSection.style.display = 'block';
      renderAdminTeam();
    } else {
      masterSection.style.display = 'none';
    }
  }
}

function renderApprovedDonorsTable(list) {
  const body = document.getElementById('approvedDonorsTableBody');
  if (list.length === 0) {
    body.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center; padding:2rem; color:#64748b;">
          কোনো অনুমোদিত ডোনার পাওয়া যায়নি।
        </td>
      </tr>
    `;
    return;
  }

  body.innerHTML = list.map(donor => {
    const inCooldown = isDonorInCooldown(donor);
    const lastStr = donor.lastDonationDate 
      ? new Date(donor.lastDonationDate).toLocaleDateString('bn-BD', { year: 'numeric', month: 'short', day: 'numeric' })
      : 'রেকর্ড নেই';

    return `
      <tr>
        <td><strong>${donor.name}</strong></td>
        <td><span class="donor-cell-group">${donor.bloodGroup}</span></td>
        <td>${donor.phone}</td>
        <td>${donor.district}, ${donor.area}</td>
        <td>${lastStr}</td>
        <td>
          ${inCooldown ? `
            <span class="status-pill cooldown">
              বিশ্রামে (${toBnNum(getRemainingCooldownTime(donor.cooldownUntil).days)} দিন বাকি)
            </span>
          ` : `
            <span class="status-pill available">প্রস্তুত (কল খোলা)</span>
          `}
        </td>
        <td>
          <div class="action-btns-wrap">
            <button class="btn-table-action cooldown-toggle" onclick="adminToggleCooldown('${donor.id}')" title="৯০ দিনের অবস্থা পরিবর্তন">
              ${inCooldown ? '🔓 কল আনলক করুন' : '⏳ ৯০ দিন বিশ্রাম দিন'}
            </button>
            <button class="btn-table-action reject" onclick="adminDeleteDonor('${donor.id}')" title="ডোনার মুছে ফেলুন">
              🗑️ ডিলিট
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function filterAdminTable() {
  const q = document.getElementById('adminSearchInput').value.toLowerCase().trim();
  const approved = state.donors.filter(d => d.approvalStatus === 'APPROVED');
  if (!q) {
    renderApprovedDonorsTable(approved);
    return;
  }
  const filtered = approved.filter(d => 
    d.name.toLowerCase().includes(q) ||
    d.bloodGroup.toLowerCase().includes(q) ||
    d.district.toLowerCase().includes(q) ||
    d.phone.includes(q)
  );
  renderApprovedDonorsTable(filtered);
}

// Admin Action: Approve Donor
async function adminApproveDonor(donorId) {
  const donor = state.donors.find(d => d.id === donorId);
  if (!donor) return;

  try {
    if (state.usingFirebase) {
      await updateDonorInCloud(donorId, { approvalStatus: 'APPROVED' });
    } else {
      donor.approvalStatus = 'APPROVED';
      localStorage.setItem(STORAGE_DONORS_BACKUP_KEY, JSON.stringify(state.donors));
      onDonorsUpdated();
    }
    showToast(`${donor.name}-এর প্রোফাইল অনুমোদিত হয়েছে! এটি এখন সাধারণ সাইটে দৃশ্যমান।`, 'success');
  } catch (err) {
    alert('অনুমোদন ব্যর্থ: ' + err.message);
  }
}

// Admin Action: Reject Donor
async function adminRejectDonor(donorId) {
  if (!confirm('আপনি কি নিশ্চিত যে এই ডোনারের রেজিস্ট্রেশন বাতিল করতে চান?')) return;
  try {
    if (state.usingFirebase) {
      await deleteDonorFromCloud(donorId);
    } else {
      state.donors = state.donors.filter(d => d.id !== donorId);
      localStorage.setItem(STORAGE_DONORS_BACKUP_KEY, JSON.stringify(state.donors));
      onDonorsUpdated();
    }
    showToast('রেজিস্ট্রেশন বাতিল ও মুছে ফেলা হয়েছে', 'info');
  } catch (err) {
    alert('বাতিল ব্যর্থ: ' + err.message);
  }
}

// Admin Action: Toggle 90-Day Cooldown Manually
async function adminToggleCooldown(donorId) {
  const donor = state.donors.find(d => d.id === donorId);
  if (!donor) return;

  const inCooldown = isDonorInCooldown(donor);
  const updates = inCooldown 
    ? { cooldownUntil: 0 }
    : { lastDonationDate: new Date().toISOString(), cooldownUntil: Date.now() + COOLDOWN_DURATION_MS };

  try {
    if (state.usingFirebase) {
      await updateDonorInCloud(donorId, updates);
    } else {
      Object.assign(donor, updates);
      localStorage.setItem(STORAGE_DONORS_BACKUP_KEY, JSON.stringify(state.donors));
      onDonorsUpdated();
    }
    showToast(`${donor.name}-এর স্ট্যাটাস সফলভাবে পরিবর্তিত হয়েছে`, 'success');
  } catch (err) {
    alert('পরিবর্তন ব্যর্থ: ' + err.message);
  }
}

// Admin Action: Delete Donor
async function adminDeleteDonor(donorId) {
  const donor = state.donors.find(d => d.id === donorId);
  if (!confirm(`আপনি কি নিশ্চিত যে ${donor ? donor.name : 'এই ডোনার'}-কে ডাটাবেস থেকে ডিলিট করতে চান?`)) return;

  try {
    if (state.usingFirebase) {
      await deleteDonorFromCloud(donorId);
    } else {
      state.donors = state.donors.filter(d => d.id !== donorId);
      localStorage.setItem(STORAGE_DONORS_BACKUP_KEY, JSON.stringify(state.donors));
      onDonorsUpdated();
    }
    showToast('ডোনার সফলভাবে মুছে ফেলা হয়েছে', 'info');
  } catch (err) {
    alert('মুছে ফেলা ব্যর্থ: ' + err.message);
  }
}

// Admin Manual Add Donor Modal
function openAddDonorModal() {
  openModal('adminAddDonorModal');
}

function toggleManualDonationDateInput() {
  const st = document.getElementById('manualStatus').value;
  document.getElementById('manualDateGroup').style.display = st === 'COOLDOWN' ? 'block' : 'none';
}

async function handleAdminAddDonor(e) {
  e.preventDefault();

  const name = document.getElementById('manualName').value.trim();
  const bloodGroup = document.getElementById('manualBloodGroup').value;
  const phone = document.getElementById('manualPhone').value.trim();
  const district = document.getElementById('manualDistrict').value;
  const area = document.getElementById('manualArea').value.trim();
  const statusChoice = document.getElementById('manualStatus').value;
  const lastDonationDateInput = document.getElementById('manualLastDonation').value;

  let cooldownUntil = 0;
  let lastDonationDate = null;

  if (statusChoice === 'COOLDOWN') {
    if (lastDonationDateInput) {
      lastDonationDate = new Date(lastDonationDateInput).toISOString();
      cooldownUntil = new Date(lastDonationDateInput).getTime() + COOLDOWN_DURATION_MS;
    } else {
      lastDonationDate = new Date().toISOString();
      cooldownUntil = Date.now() + COOLDOWN_DURATION_MS;
    }
  }

  const cleanPhone = normalizePhoneSalt(phone);
  const passwordHash = await hashPassword('1234', cleanPhone);

  const manualDonor = {
    id: 'donor_man_' + Date.now(),
    name,
    bloodGroup,
    phone,
    district,
    area,
    passwordHash, // Cryptographically secured hash!
    approvalStatus: 'APPROVED', // Manually added donors by admin are AUTO-APPROVED
    lastDonationDate,
    cooldownUntil,
    totalDonations: lastDonationDate ? 1 : 0,
    registeredAt: new Date().toISOString().split('T')[0]
  };

  try {
    if (state.usingFirebase) {
      await saveDonorToCloud(manualDonor);
    } else {
      state.donors.unshift(manualDonor);
      localStorage.setItem(STORAGE_DONORS_BACKUP_KEY, JSON.stringify(sanitizeDonorsList(state.donors)));
      onDonorsUpdated();
    }

    closeModal('adminAddDonorModal');
    document.getElementById('adminAddDonorForm').reset();
    showToast(`ডোনার ${name} সফলভাবে ফায়ারবেস ক্লাউডে যোগ করা হয়েছে!`, 'success');
  } catch (err) {
    alert('ম্যানুয়াল যোগ ব্যর্থ: ' + err.message);
  }
}

// ==========================================================================
// Master Admin: Admin Team Management Handlers
// ==========================================================================
function renderAdminTeam() {
  const tbody = document.getElementById('adminTeamTableBody');
  if (!tbody) return;

  let html = `
    <tr>
      <td><strong>মাস্টার এডমিন (প্রধান)</strong></td>
      <td>${MASTER_ADMIN_PHONE}</td>
      <td><span class="badge-secure">🔒 সুরক্ষিত (মাস্টার কী)</span></td>
      <td><span class="badge-role-master">👑 মাস্টার এডমিন</span></td>
      <td style="text-align: right;"><span class="text-muted" style="font-size:0.85rem;">ডিফল্ট (স্থায়ী)</span></td>
    </tr>
  `;

  if (!state.admins || state.admins.length === 0) {
    html += `
      <tr>
        <td colspan="5" style="text-align: center; padding: 1.5rem; color: #64748b;">
          কোনো সাব-এডমিন এখনও যোগ করা হয়নি। উপরের <strong>"নতুন এডমিন যোগ করুন"</strong> বাটনে ক্লিক করে যোগ করতে পারেন।
        </td>
      </tr>
    `;
  } else {
    html += state.admins.map(admin => `
      <tr>
        <td><strong>${admin.name}</strong></td>
        <td>${admin.phone}</td>
        <td><span class="badge-secure"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg> সুরক্ষিত (গোপন)</span></td>
        <td><span class="badge-role-admin">সাধারণ এডমিন</span></td>
        <td style="text-align: right;">
          <button class="btn-table-action delete" onclick="removeAdminAccount('${admin.id}', '${admin.name}')">
            🗑️ রিমুভ করুন
          </button>
        </td>
      </tr>
    `).join('');
  }

  tbody.innerHTML = html;
}

function openAddAdminModal() {
  const form = document.getElementById('addAdminForm');
  if (form) form.reset();
  openModal('addAdminModal');
}

async function handleCreateAdmin(e) {
  e.preventDefault();
  const name = document.getElementById('newAdminName').value.trim();
  const phone = document.getElementById('newAdminPhone').value.trim();
  const password = document.getElementById('newAdminPassword').value.trim();

  const strength = validatePasswordStrength(password);
  if (!strength.valid) {
    alert(strength.message);
    return;
  }

  const cleanPhone = normalizePhoneSalt(phone);
  if (cleanPhone === MASTER_ADMIN_PHONE) {
    alert('এই নম্বরটি মাস্টার এডমিনের জন্য সংরক্ষিত!');
    return;
  }

  if (state.admins.some(a => normalizePhoneSalt(a.phone) === cleanPhone || a.phone === phone)) {
    alert('এই মোবাইল নম্বরে ইতিমধ্যে একজন এডমিন যোগ করা আছে!');
    return;
  }

  const passwordHash = await hashPassword(password, cleanPhone);

  const newAdmin = {
    id: 'admin_' + Date.now(),
    name,
    phone,
    passwordHash, // Cryptographically secured!
    role: 'ADMIN',
    createdAt: new Date().toISOString()
  };

  try {
    if (state.usingFirebase) {
      await saveAdminToCloud(newAdmin);
    } else {
      state.admins.push(newAdmin);
      localStorage.setItem(STORAGE_ADMINS_BACKUP_KEY, JSON.stringify(state.admins));
      renderAdminTeam();
    }

    closeModal('addAdminModal');
    showToast(`নতুন এডমিন "${name}" সফলভাবে যুক্ত হয়েছে! পাসওয়ার্ড এনক্রিপ্ট করা হয়েছে।`, 'success');
  } catch (err) {
    console.error('Failed to create admin:', err);
    alert('এডমিন সংরক্ষণ ব্যর্থ হয়েছে: ' + err.message);
  }
}

// ==========================================================================
// Password Management & Security Handlers
// ==========================================================================
function togglePasswordVisibility(inputId, btnEl) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isPass = input.type === 'password';
  input.type = isPass ? 'text' : 'password';
  if (btnEl) {
    btnEl.innerHTML = isPass 
      ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`
      : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
  }
}

function openDonorChangePasswordModal() {
  const form = document.getElementById('donorChangePassForm');
  if (form) form.reset();
  openModal('donorChangePassModal');
}

async function handleDonorChangePassword(e) {
  e.preventDefault();
  if (!state.currentDonor) {
    alert('প্রথমে আপনার একাউন্টে লগইন করুন।');
    return;
  }

  const oldPass = document.getElementById('donorOldPassword').value.trim();
  const newPass = document.getElementById('donorNewPassword').value.trim();
  const confirmPass = document.getElementById('donorConfirmPassword').value.trim();

  // 1. Verify old password
  const isOldValid = await verifyUserPassword(oldPass, state.currentDonor);
  if (!isOldValid) {
    alert('বর্তমান পাসওয়ার্ডটি সঠিক নয়!');
    return;
  }

  // 2. Validate new password strength
  const strength = validatePasswordStrength(newPass);
  if (!strength.valid) {
    alert(strength.message);
    return;
  }

  if (newPass !== confirmPass) {
    alert('নতুন পাসওয়ার্ড এবং নিশ্চিতকরণ পাসওয়ার্ড মিলছে না!');
    return;
  }

  // 3. Compute new salted hash
  const newHash = await hashPassword(newPass, state.currentDonor.phone);

  try {
    if (state.usingFirebase) {
      await updateDonorInCloud(state.currentDonor.id, { passwordHash: newHash, password: null });
    }
    state.currentDonor.passwordHash = newHash;
    delete state.currentDonor.password;

    closeModal('donorChangePassModal');
    showToast('🔒 পাসওয়ার্ড সফলভাবে পরিবর্তিত হয়েছে ও ক্লাউডে এনক্রিপ্ট করে সেভ করা হয়েছে!', 'success');
  } catch (err) {
    console.error('Password change error:', err);
    alert('পাসওয়ার্ড পরিবর্তন ব্যর্থ হয়েছে: ' + err.message);
  }
}

function openMasterChangePasswordModal() {
  const form = document.getElementById('masterChangePassForm');
  if (form) form.reset();
  openModal('masterChangePassModal');
}

async function handleMasterChangePassword(e) {
  e.preventDefault();
  if (!state.isAdmin || !state.isMasterAdmin) {
    alert('শুধুমাত্র মাস্টার এডমিন এই পাসওয়ার্ড পরিবর্তন করতে পারেন।');
    return;
  }

  const oldPass = document.getElementById('masterOldPassword').value.trim();
  const newPass = document.getElementById('masterNewPassword').value.trim();
  const confirmPass = document.getElementById('masterConfirmPassword').value.trim();

  // 1. Verify current master pass
  const isOldValid = await verifyMasterAdminPassword(MASTER_ADMIN_PHONE, oldPass);
  if (!isOldValid) {
    alert('বর্তমান মাস্টার পাসওয়ার্ড সঠিক নয়!');
    return;
  }

  // 2. Validate new password strength
  const strength = validatePasswordStrength(newPass);
  if (!strength.valid) {
    alert(strength.message);
    return;
  }

  if (newPass !== confirmPass) {
    alert('নতুন পাসওয়ার্ড এবং নিশ্চিতকরণ পাসওয়ার্ড মিলছে না!');
    return;
  }

  // 3. Compute new salted hash and persist
  const newHash = await hashPassword(newPass, MASTER_ADMIN_PHONE);
  localStorage.setItem('blood_seva_master_pass_hash', newHash);

  closeModal('masterChangePassModal');
  showToast('👑 মাস্টার এডমিন পাসওয়ার্ড সফলভাবে আপডেট ও ক্রিপ্টোগ্রাফিকভাবে সুরক্ষিত করা হয়েছে!', 'success');
}

async function removeAdminAccount(adminId, adminName) {
  if (!confirm(`আপনি কি নিশ্চিত যে "${adminName}" এডমিন একাউন্টটি মুছে ফেলতে চান?`)) {
    return;
  }

  try {
    if (state.usingFirebase) {
      await deleteAdminFromCloud(adminId);
    } else {
      state.admins = state.admins.filter(a => a.id !== adminId);
      localStorage.setItem(STORAGE_ADMINS_BACKUP_KEY, JSON.stringify(state.admins));
      renderAdminTeam();
    }

    showToast(`এডমিন "${adminName}" সফলভাবে রিমুভ করা হয়েছে`, 'success');
  } catch (err) {
    console.error('Failed to delete admin:', err);
    alert('এডমিন রিমুভ ব্যর্থ হয়েছে: ' + err.message);
  }
}

// ==========================================================================
// Firebase Settings Modal Handlers
// ==========================================================================
function handleSaveFirebaseConfig(e) {
  e.preventDefault();
  const apiKey = document.getElementById('fbApiKey').value.trim();
  const projectId = document.getElementById('fbProjectId').value.trim();
  const authDomain = document.getElementById('fbAuthDomain').value.trim() || `${projectId}.firebaseapp.com`;
  const storageBucket = document.getElementById('fbStorageBucket').value.trim() || `${projectId}.appspot.com`;
  const appId = document.getElementById('fbAppId').value.trim();

  const cfg = { apiKey, projectId, authDomain, storageBucket, appId };
  saveCustomFirebaseConfig(cfg);
}

function handleClearFirebaseConfig() {
  if (confirm('ফায়ারবেস কনফিগারেশন রিসেট করতে চান?')) {
    clearCustomFirebaseConfig();
  }
}

// ==========================================================================
// Modal Handlers & UI Notifications
// ==========================================================================
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.style.display = 'flex';
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.style.display = 'none';
}

window.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-backdrop')) {
    e.target.style.display = 'none';
  }
});

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icon = type === 'success' ? '✅' : type === 'warning' ? '⏳' : 'ℹ️';
  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ==========================================================================
// Attach methods to Window object for HTML inline handlers in ES Module
// ==========================================================================
window.switchView = switchView;
window.selectQuickBloodGroup = selectQuickBloodGroup;
window.updateQuickBloodChipsUI = updateQuickBloodChipsUI;
window.applyFilters = applyFilters;
window.resetFilters = resetFilters;
window.openUnifiedLoginModal = openUnifiedLoginModal;
window.openCurrentPortal = openCurrentPortal;
window.handleUnifiedLogin = handleUnifiedLogin;
window.handleLogout = handleLogout;
window.openRegisterModal = openRegisterModal;
window.openRegisterFromLogin = openRegisterFromLogin;
window.handleDonorRegister = handleDonorRegister;
window.confirmMarkDonated = confirmMarkDonated;
window.executeMarkDonated = executeMarkDonated;
window.adminApproveDonor = adminApproveDonor;
window.adminRejectDonor = adminRejectDonor;
window.adminToggleCooldown = adminToggleCooldown;
window.adminDeleteDonor = adminDeleteDonor;
window.openAddDonorModal = openAddDonorModal;
window.toggleManualDonationDateInput = toggleManualDonationDateInput;
window.handleAdminAddDonor = handleAdminAddDonor;
window.openAddAdminModal = openAddAdminModal;
window.handleCreateAdmin = handleCreateAdmin;
window.removeAdminAccount = removeAdminAccount;
window.handleSaveFirebaseConfig = handleSaveFirebaseConfig;
window.handleClearFirebaseConfig = handleClearFirebaseConfig;
window.openModal = openModal;
window.closeModal = closeModal;
window.alertLockedDonor = alertLockedDonor;
window.recordCallAttempt = recordCallAttempt;
window.filterAdminTable = filterAdminTable;
window.handleInstallApp = handleInstallApp;
window.executeAppInstall = executeAppInstall;
window.handleMobileAuthClick = handleMobileAuthClick;
window.togglePasswordVisibility = togglePasswordVisibility;
window.openDonorChangePasswordModal = openDonorChangePasswordModal;
window.handleDonorChangePassword = handleDonorChangePassword;
window.openMasterChangePasswordModal = openMasterChangePasswordModal;
window.handleMasterChangePassword = handleMasterChangePassword;

// ==========================================================================
// PWA Service Worker & Direct App Installation
// ==========================================================================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
    .then((reg) => console.log('✅ ServiceWorker registered:', reg.scope))
    .catch((err) => console.warn('ServiceWorker registration error:', err));
}

window.addEventListener('appinstalled', () => {
  window.deferredInstallPrompt = null;
  showToast('🎉 অ্যাপ সফলভাবে আপনার মোবাইলের হোম স্ক্রিনে যুক্ত হয়েছে!', 'success');
});

function handleInstallApp() {
  // Check if already running as installed standalone app
  if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
    showToast('ব্লাড সেবা অ্যাপটি ইতিমধ্যে আপনার ফোনে ইনস্টল রয়েছে!', 'success');
    return;
  }

  // Open the direct install confirmation modal
  openModal('directInstallModal');
}

async function executeAppInstall() {
  closeModal('directInstallModal');

  const promptEvent = window.deferredInstallPrompt;

  if (promptEvent) {
    promptEvent.prompt();
    try {
      const choice = await promptEvent.userChoice;
      if (choice && choice.outcome === 'accepted') {
        showToast('🎉 অ্যাপটি ইনস্টল হয়ে আপনার হোম স্ক্রিনে যুক্ত হচ্ছে...', 'success');
        window.deferredInstallPrompt = null;
      }
    } catch (e) {
      console.warn('User choice error:', e);
    }
    return;
  }

  showToast('ব্রাউজারের ইনস্টল ডায়ালগে "Install" চাপুন...', 'info');
}


