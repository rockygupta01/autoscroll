/**
 * background.js — Service Worker for Contact Extractor
 * 
 * Handles:
 *  - Message relay between popup and content scripts
 *  - File downloads (CSV/XLSX export)
 *  - Default settings initialization on install
 *  - Contact storage management
 * 
 * IMPORTANT: Service workers are ephemeral in MV3. 
 * All state is stored in chrome.storage — NO global variables for state.
 */

// ============================================================
// DEFAULT SETTINGS
// ============================================================

const DEFAULT_SETTINGS = {
  scrollSpeed: 300,
  pauseDuration: 2000,
  maxScrollAttempts: 3,
  ignoreDuplicates: true,
  enablePhoneExtraction: true,
};

// ============================================================
// INITIALIZATION
// ============================================================

/**
 * Set up default settings on install
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await chrome.storage.local.set({
      settings: DEFAULT_SETTINGS,
      contacts: [],
    });
    console.log('[ContactExtractor] Extension installed. Default settings saved.');
  }
});

// ============================================================
// MESSAGE HANDLING
// ============================================================

/**
 * Central message router
 * Routes messages between popup and content scripts
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    // ---- Contact data from content script ----
    case 'CONTACTS_FOUND':
      handleContactsFound(message, sender);
      break;

    // ---- Scroll progress from content script ----
    case 'SCROLL_PROGRESS':
      // Store progress in session storage for popup to read
      chrome.storage.session.set({
        scrollProgress: message.percentage,
      });
      break;

    // ---- Scroll complete from content script ----
    case 'SCROLL_COMPLETE':
      chrome.storage.session.set({
        scrollState: 'completed',
        scrollProgress: message.percentage,
      });
      break;

    // ---- Content script ready notification ----
    case 'CONTENT_READY':
      console.log('[ContactExtractor] Content script ready on:', message.url);
      break;

    // ---- Download file request from popup ----
    case 'DOWNLOAD_FILE':
      handleDownload(message, sendResponse);
      return true; // async response

    // ---- Get all contacts from storage ----
    case 'GET_CONTACTS':
      (async () => {
        const { contacts = [] } = await chrome.storage.local.get('contacts');
        sendResponse({ contacts });
      })();
      return true; // async response

    // ---- Save settings ----
    case 'SAVE_SETTINGS':
      (async () => {
        await chrome.storage.local.set({ settings: message.settings });
        sendResponse({ status: 'saved' });
      })();
      return true; // async response

    // ---- Get settings ----
    case 'GET_SETTINGS':
      (async () => {
        const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get('settings');
        sendResponse({ settings });
      })();
      return true; // async response

    // ---- Clear all contacts ----
    case 'CLEAR_CONTACTS':
      (async () => {
        await chrome.storage.local.set({ contacts: [] });
        sendResponse({ status: 'cleared' });
      })();
      return true; // async response
  }
});

// ============================================================
// HANDLERS
// ============================================================

/**
 * Handles new contacts found by content script
 * Merges with existing contacts in storage, deduplicating by email
 * @param {object} message - The message with contacts data
 * @param {object} sender - The sender info
 */
async function handleContactsFound(message, sender) {
  try {
    const { contacts: newContacts = [] } = message;
    if (newContacts.length === 0) return;

    // Get existing contacts from storage
    const { contacts: existingContacts = [] } = await chrome.storage.local.get('contacts');

    // Build set of existing emails for dedup
    const existingEmails = new Set(
      existingContacts
        .filter(c => c.email)
        .map(c => c.email.toLowerCase())
    );

    // Filter out duplicates
    const uniqueNew = newContacts.filter(contact => {
      if (!contact.email) {
        // Phone-only contacts — check phone dedup
        const phoneKey = `phone:${(contact.phone || '').replace(/\D/g, '')}`;
        if (existingEmails.has(phoneKey)) return false;
        existingEmails.add(phoneKey);
        return true;
      }

      const emailKey = contact.email.toLowerCase();
      if (existingEmails.has(emailKey)) return false;
      existingEmails.add(emailKey);
      return true;
    });

    if (uniqueNew.length === 0) return;

    // Merge and save
    const merged = [...existingContacts, ...uniqueNew];
    await chrome.storage.local.set({ contacts: merged });

    console.log(`[ContactExtractor] Saved ${uniqueNew.length} new contacts. Total: ${merged.length}`);
  } catch (error) {
    console.error('[ContactExtractor] Error saving contacts:', error);
  }
}

/**
 * Handles file download requests from popup
 * Creates a blob URL and triggers download
 * @param {object} message - The download request with data and filename
 * @param {function} sendResponse - Response callback
 */
async function handleDownload(message, sendResponse) {
  try {
    const { dataUrl, filename } = message;

    if (!dataUrl || !filename) {
      sendResponse({ status: 'error', error: 'Missing dataUrl or filename' });
      return;
    }

    const downloadId = await chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: true,
    });

    sendResponse({ status: 'downloaded', downloadId });
  } catch (error) {
    console.error('[ContactExtractor] Download error:', error);
    sendResponse({ status: 'error', error: error.message });
  }
}
