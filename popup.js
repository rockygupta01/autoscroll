/**
 * popup.js — Popup controller for Contact Extractor
 * 
 * Handles:
 *  - Loading/saving contacts and settings from chrome.storage
 *  - Button state management (Start/Pause/Resume/Stop)
 *  - Table rendering with live updates
 *  - Settings panel toggle and persistence
 *  - Export triggers (CSV/XLSX)
 *  - Toast notifications
 *  - Real-time progress updates
 */

// ============================================================
// DOM ELEMENTS
// ============================================================

const elements = {
  // Header
  currentUrl: document.getElementById('currentUrl'),
  settingsToggle: document.getElementById('settingsToggle'),

  // Settings
  settingsPanel: document.getElementById('settingsPanel'),
  scrollSpeed: document.getElementById('scrollSpeed'),
  scrollSpeedValue: document.getElementById('scrollSpeedValue'),
  pauseDuration: document.getElementById('pauseDuration'),
  pauseDurationValue: document.getElementById('pauseDurationValue'),
  maxScrollAttempts: document.getElementById('maxScrollAttempts'),
  maxScrollAttemptsValue: document.getElementById('maxScrollAttemptsValue'),
  ignoreDuplicates: document.getElementById('ignoreDuplicates'),
  enablePhoneExtraction: document.getElementById('enablePhoneExtraction'),

  // Stats
  totalContacts: document.getElementById('totalContacts'),
  emailCount: document.getElementById('emailCount'),
  phoneCount: document.getElementById('phoneCount'),
  scrollPercentage: document.getElementById('scrollPercentage'),

  // Progress
  progressBar: document.getElementById('progressBar'),

  // Controls
  btnStart: document.getElementById('btnStart'),
  btnPause: document.getElementById('btnPause'),
  btnResume: document.getElementById('btnResume'),
  btnStop: document.getElementById('btnStop'),

  // Status
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),

  // Table
  tableBody: document.getElementById('tableBody'),
  dataTable: document.getElementById('dataTable'),
  emptyState: document.getElementById('emptyState'),

  // Actions
  btnExportCSV: document.getElementById('btnExportCSV'),
  btnExportXLSX: document.getElementById('btnExportXLSX'),
  btnClear: document.getElementById('btnClear'),

  // Toast
  toast: document.getElementById('toast'),
  toastText: document.getElementById('toastText'),
};

// ============================================================
// STATE
// ============================================================

/** Contacts currently loaded from storage */
let contacts = [];

/** Current scroll state for this tab */
let currentState = 'idle'; // 'idle' | 'scrolling' | 'paused' | 'stopped' | 'completed'

/** Active tab ID */
let activeTabId = null;

// ============================================================
// INITIALIZATION
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  await loadContacts();
  await loadSettings();
  await loadActiveTab();
  await loadScrollState();
  registerEventListeners();
  renderTable();
  updateStats();
});

/**
 * Loads contacts from chrome.storage.local
 */
async function loadContacts() {
  try {
    const { contacts: stored = [] } = await chrome.storage.local.get('contacts');
    contacts = stored;
  } catch (e) {
    console.error('[Popup] Failed to load contacts:', e);
    contacts = [];
  }
}

/**
 * Loads settings from chrome.storage.local and populates the form
 */
async function loadSettings() {
  try {
    const { settings = {} } = await chrome.storage.local.get('settings');

    if (settings.scrollSpeed !== undefined) {
      elements.scrollSpeed.value = settings.scrollSpeed;
      elements.scrollSpeedValue.textContent = settings.scrollSpeed + 'px';
    }
    if (settings.pauseDuration !== undefined) {
      elements.pauseDuration.value = settings.pauseDuration;
      elements.pauseDurationValue.textContent = (settings.pauseDuration / 1000).toFixed(1) + 's';
    }
    if (settings.maxScrollAttempts !== undefined) {
      elements.maxScrollAttempts.value = settings.maxScrollAttempts;
      elements.maxScrollAttemptsValue.textContent = settings.maxScrollAttempts;
    }
    if (settings.ignoreDuplicates !== undefined) {
      elements.ignoreDuplicates.checked = settings.ignoreDuplicates;
    }
    if (settings.enablePhoneExtraction !== undefined) {
      elements.enablePhoneExtraction.checked = settings.enablePhoneExtraction;
    }
  } catch (e) {
    console.error('[Popup] Failed to load settings:', e);
  }
}

/**
 * Gets the active tab info
 */
async function loadActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      activeTabId = tab.id;
      elements.currentUrl.textContent = tab.url || 'Unknown page';
      elements.currentUrl.title = tab.url || '';
    }
  } catch (e) {
    console.error('[Popup] Failed to get active tab:', e);
  }
}

/**
 * Loads scroll state from chrome.storage.session
 */
async function loadScrollState() {
  try {
    const { scrollState = 'idle', scrollProgress = 0 } = await chrome.storage.session.get([
      'scrollState',
      'scrollProgress',
    ]);

    currentState = scrollState;
    updateButtonStates();
    updateStatus(currentState);
    updateProgress(scrollProgress);
  } catch (e) {
    // session storage might not be available
    console.warn('[Popup] Could not load scroll state:', e);
  }
}

// ============================================================
// EVENT LISTENERS
// ============================================================

function registerEventListeners() {
  // Settings toggle
  elements.settingsToggle.addEventListener('click', toggleSettings);

  // Settings changes — save on change
  elements.scrollSpeed.addEventListener('input', handleSettingChange);
  elements.pauseDuration.addEventListener('input', handleSettingChange);
  elements.maxScrollAttempts.addEventListener('input', handleSettingChange);
  elements.ignoreDuplicates.addEventListener('change', handleSettingChange);
  elements.enablePhoneExtraction.addEventListener('change', handleSettingChange);

  // Control buttons
  elements.btnStart.addEventListener('click', handleStart);
  elements.btnPause.addEventListener('click', handlePause);
  elements.btnResume.addEventListener('click', handleResume);
  elements.btnStop.addEventListener('click', handleStop);

  // Export buttons
  elements.btnExportCSV.addEventListener('click', handleExportCSV);
  elements.btnExportXLSX.addEventListener('click', handleExportXLSX);

  // Clear button
  elements.btnClear.addEventListener('click', handleClear);

  // Listen for messages from content script (via background)
  chrome.runtime.onMessage.addListener(handleMessage);

  // Listen for storage changes to keep popup in sync
  chrome.storage.onChanged.addListener(handleStorageChange);
}

// ============================================================
// SETTINGS
// ============================================================

function toggleSettings() {
  const panel = elements.settingsPanel;
  const btn = elements.settingsToggle;

  panel.classList.toggle('open');
  btn.classList.toggle('active');
}

async function handleSettingChange() {
  // Update display values
  elements.scrollSpeedValue.textContent = elements.scrollSpeed.value + 'px';
  elements.pauseDurationValue.textContent = (elements.pauseDuration.value / 1000).toFixed(1) + 's';
  elements.maxScrollAttemptsValue.textContent = elements.maxScrollAttempts.value;

  // Save to storage
  const settings = getSettings();
  try {
    await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings });
  } catch (e) {
    console.error('[Popup] Failed to save settings:', e);
  }
}

function getSettings() {
  return {
    scrollSpeed: parseInt(elements.scrollSpeed.value, 10),
    pauseDuration: parseInt(elements.pauseDuration.value, 10),
    maxScrollAttempts: parseInt(elements.maxScrollAttempts.value, 10),
    ignoreDuplicates: elements.ignoreDuplicates.checked,
    enablePhoneExtraction: elements.enablePhoneExtraction.checked,
  };
}

// ============================================================
// CONTROL HANDLERS
// ============================================================

async function handleStart() {
  if (!activeTabId) {
    showToast('No active tab found', 'error');
    return;
  }

  try {
    // Inject utils.js first, then content.js
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      files: ['utils.js'],
    });

    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      files: ['content.js'],
    });

    // Get existing emails for cross-session dedup
    const existingEmails = contacts
      .filter(c => c.email)
      .map(c => c.email.toLowerCase());

    // Send start command with settings
    await chrome.tabs.sendMessage(activeTabId, {
      type: 'START_SCROLL',
      settings: getSettings(),
      existingEmails: existingEmails,
    });

    currentState = 'scrolling';
    updateButtonStates();
    updateStatus('scrolling');

    await chrome.storage.session.set({ scrollState: 'scrolling' });

    showToast('Scrolling started', 'success');
  } catch (e) {
    console.error('[Popup] Failed to start scrolling:', e);
    showToast('Failed to start: ' + e.message, 'error');
  }
}

async function handlePause() {
  if (!activeTabId) return;

  try {
    await chrome.tabs.sendMessage(activeTabId, { type: 'PAUSE_SCROLL' });
    currentState = 'paused';
    updateButtonStates();
    updateStatus('paused');
    await chrome.storage.session.set({ scrollState: 'paused' });
    showToast('Scrolling paused', 'success');
  } catch (e) {
    console.error('[Popup] Failed to pause:', e);
    showToast('Failed to pause', 'error');
  }
}

async function handleResume() {
  if (!activeTabId) return;

  try {
    await chrome.tabs.sendMessage(activeTabId, { type: 'RESUME_SCROLL' });
    currentState = 'scrolling';
    updateButtonStates();
    updateStatus('scrolling');
    await chrome.storage.session.set({ scrollState: 'scrolling' });
    showToast('Scrolling resumed', 'success');
  } catch (e) {
    console.error('[Popup] Failed to resume:', e);
    showToast('Failed to resume', 'error');
  }
}

async function handleStop() {
  if (!activeTabId) return;

  try {
    await chrome.tabs.sendMessage(activeTabId, { type: 'STOP_SCROLL' });
    currentState = 'stopped';
    updateButtonStates();
    updateStatus('stopped');
    await chrome.storage.session.set({ scrollState: 'idle' });
    showToast('Scrolling stopped', 'success');
  } catch (e) {
    console.error('[Popup] Failed to stop:', e);
    showToast('Failed to stop', 'error');
  }
}

// ============================================================
// EXPORT HANDLERS
// ============================================================

async function handleExportCSV() {
  if (contacts.length === 0) {
    showToast('No contacts to export', 'error');
    return;
  }

  try {
    const dataUrl = exportToCSV(contacts);

    await chrome.runtime.sendMessage({
      type: 'DOWNLOAD_FILE',
      dataUrl: dataUrl,
      filename: `contacts_${getTimestamp()}.csv`,
    });

    showToast(`Exported ${contacts.length} contacts to CSV`, 'success');
  } catch (e) {
    console.error('[Popup] CSV export failed:', e);
    showToast('Export failed: ' + e.message, 'error');
  }
}

async function handleExportXLSX() {
  if (contacts.length === 0) {
    showToast('No contacts to export', 'error');
    return;
  }

  try {
    const dataUrl = await exportToXLSX(contacts);

    await chrome.runtime.sendMessage({
      type: 'DOWNLOAD_FILE',
      dataUrl: dataUrl,
      filename: `contacts_${getTimestamp()}.xlsx`,
    });

    showToast(`Exported ${contacts.length} contacts to Excel`, 'success');
  } catch (e) {
    console.error('[Popup] XLSX export failed:', e);
    showToast('Export failed: ' + e.message, 'error');
  }
}

// ============================================================
// CLEAR DATA
// ============================================================

async function handleClear() {
  try {
    await chrome.runtime.sendMessage({ type: 'CLEAR_CONTACTS' });
    contacts = [];
    renderTable();
    updateStats();
    updateProgress(0);
    showToast('All data cleared', 'success');
  } catch (e) {
    console.error('[Popup] Failed to clear data:', e);
    showToast('Failed to clear data', 'error');
  }
}

// ============================================================
// MESSAGE HANDLING
// ============================================================

function handleMessage(message, sender, sendResponse) {
  switch (message.type) {
    case 'CONTACTS_FOUND':
      // Reload contacts from storage (background already saved them)
      loadContacts().then(() => {
        renderTable();
        updateStats();
      });
      break;

    case 'SCROLL_PROGRESS':
      updateProgress(message.percentage);
      break;

    case 'SCROLL_COMPLETE':
      currentState = 'completed';
      updateButtonStates();
      updateStatus('completed');
      updateProgress(message.percentage || 100);

      // Reload contacts one final time
      loadContacts().then(() => {
        renderTable();
        updateStats();
      });

      showToast(
        `Scroll complete! Found ${message.totalContacts || contacts.length} contacts`,
        'success'
      );
      break;
  }
}

function handleStorageChange(changes, areaName) {
  if (areaName === 'local' && changes.contacts) {
    contacts = changes.contacts.newValue || [];
    renderTable();
    updateStats();
  }
}

// ============================================================
// UI UPDATES
// ============================================================

/**
 * Renders the data table with current contacts
 */
function renderTable() {
  const tbody = elements.tableBody;
  tbody.innerHTML = '';

  if (contacts.length === 0) {
    elements.dataTable.classList.add('hidden');
    elements.emptyState.classList.remove('hidden');
    return;
  }

  elements.dataTable.classList.remove('hidden');
  elements.emptyState.classList.add('hidden');

  for (const contact of contacts) {
    const row = document.createElement('tr');
    row.classList.add('new-row');

    row.innerHTML = `
      <td title="${escapeHtml(contact.companyName || '')}">${escapeHtml(contact.companyName || '—')}</td>
      <td title="${escapeHtml(contact.personName || '')}">${escapeHtml(contact.personName || '—')}</td>
      <td class="cell-email" title="${escapeHtml(contact.email || '')}">${escapeHtml(contact.email || '—')}</td>
      <td title="${escapeHtml(contact.phone || '')}">${escapeHtml(contact.phone || '—')}</td>
      <td title="${escapeHtml(contact.website || '')}">${contact.website ? `<a href="${escapeHtml(contact.website)}" target="_blank">${truncateUrl(contact.website)}</a>` : '—'}</td>
      <td title="${escapeHtml(contact.linkedIn || '')}">${contact.linkedIn ? `<a href="${escapeHtml(contact.linkedIn)}" target="_blank">Profile</a>` : '—'}</td>
      <td title="${escapeHtml(contact.sourceUrl || '')}">${truncateUrl(contact.sourceUrl || '—')}</td>
    `;

    tbody.appendChild(row);
  }
}

/**
 * Updates the stats dashboard
 */
function updateStats() {
  const total = contacts.length;
  const emails = contacts.filter(c => c.email).length;
  const phones = contacts.filter(c => c.phone).length;

  animateStatValue(elements.totalContacts, total);
  animateStatValue(elements.emailCount, emails);
  animateStatValue(elements.phoneCount, phones);
}

/**
 * Animates a stat value update
 */
function animateStatValue(element, value) {
  element.textContent = value;
  element.classList.add('updated');
  setTimeout(() => element.classList.remove('updated'), 300);
}

/**
 * Updates the progress bar and percentage display
 */
function updateProgress(percentage) {
  const pct = Math.min(100, Math.max(0, Math.round(percentage || 0)));
  elements.progressBar.style.width = pct + '%';
  elements.scrollPercentage.textContent = pct + '%';
}

/**
 * Updates button enabled/disabled states based on scroll state
 */
function updateButtonStates() {
  switch (currentState) {
    case 'idle':
    case 'stopped':
    case 'completed':
      elements.btnStart.disabled = false;
      elements.btnPause.disabled = true;
      elements.btnResume.disabled = true;
      elements.btnStop.disabled = true;
      break;

    case 'scrolling':
      elements.btnStart.disabled = true;
      elements.btnPause.disabled = false;
      elements.btnResume.disabled = true;
      elements.btnStop.disabled = false;
      break;

    case 'paused':
      elements.btnStart.disabled = true;
      elements.btnPause.disabled = true;
      elements.btnResume.disabled = false;
      elements.btnStop.disabled = false;
      break;
  }
}

/**
 * Updates the status bar indicator
 */
function updateStatus(state) {
  const dot = elements.statusDot;
  const text = elements.statusText;

  // Remove all state classes
  dot.classList.remove('active', 'paused', 'error', 'completed');

  switch (state) {
    case 'scrolling':
      dot.classList.add('active');
      text.textContent = 'Scrolling...';
      break;
    case 'paused':
      dot.classList.add('paused');
      text.textContent = 'Paused';
      break;
    case 'stopped':
      text.textContent = 'Stopped';
      break;
    case 'completed':
      dot.classList.add('completed');
      text.textContent = 'Scroll complete';
      break;
    case 'error':
      dot.classList.add('error');
      text.textContent = 'Error occurred';
      break;
    default:
      text.textContent = 'Ready';
  }
}

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================

let toastTimeout = null;

function showToast(message, type = 'success') {
  const toast = elements.toast;
  const toastText = elements.toastText;

  // Clear existing timeout
  if (toastTimeout) {
    clearTimeout(toastTimeout);
  }

  // Remove existing classes
  toast.classList.remove('show', 'success', 'error');

  // Set content and type
  toastText.textContent = message;
  toast.classList.add(type);

  // Show
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  // Auto-hide after 3 seconds
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// ============================================================
// UTILITIES
// ============================================================

/**
 * Escapes HTML entities to prevent XSS
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Truncates a URL for display
 */
function truncateUrl(url) {
  if (!url || url === '—') return url;
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace('www.', '');
  } catch {
    return url.length > 25 ? url.substring(0, 25) + '...' : url;
  }
}

/**
 * Generates a timestamp string for filenames
 */
function getTimestamp() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '_',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
  ].join('');
}
