/**
 * content.js — Auto-scroll engine and contact extraction content script
 * 
 * Injected programmatically into the active tab when the user clicks Start.
 * Handles:
 *  - Smooth auto-scrolling with configurable speed and pause duration
 *  - Contact information extraction (emails, phones, LinkedIn, websites, names, companies)
 *  - Deduplication by email
 *  - Progress reporting back to the popup
 *  - Pause / Resume / Stop controls
 */

(() => {
  // Guard against double-injection
  if (window.__contactExtractorInjected) {
    return;
  }
  window.__contactExtractorInjected = true;

  // ============================================================
  // STATE
  // ============================================================

  /** Current scroll state: 'idle' | 'scrolling' | 'paused' | 'stopped' */
  let scrollState = 'idle';

  /** Set of emails already found — used for deduplication */
  const seenEmails = new Set();

  /** Set of phone numbers already assigned to contacts — prevents re-assignment */
  const seenPhones = new Set();

  /** Set of LinkedIn URLs already assigned to contacts */
  const seenLinkedIn = new Set();

  /** Set of website URLs already assigned to contacts */
  const seenWebsites = new Set();

  /** All contacts extracted during this session */
  const extractedContacts = [];

  /** Settings (overridden by message from popup) */
  let settings = {
    scrollSpeed: 300,        // pixels per scroll step
    pauseDuration: 2000,     // ms to wait after each scroll for content to load
    maxScrollAttempts: 3,    // max attempts before declaring bottom reached
    ignoreDuplicates: true,  // skip duplicate emails
    enablePhoneExtraction: true,
  };

  /** Track scroll position for bottom detection */
  let lastScrollY = -1;
  let unchangedScrollCount = 0;

  // ============================================================
  // HELPERS
  // ============================================================

  /**
   * Returns a promise that resolves after the given milliseconds
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Calculates the current scroll percentage
   * @returns {number} Scroll percentage (0-100)
   */
  function getScrollPercentage() {
    const scrollTop = window.scrollY;
    const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
    if (scrollHeight <= 0) return 100;
    return Math.min(100, Math.round((scrollTop / scrollHeight) * 100));
  }

  /**
   * Checks if we've reached the bottom of the page
   * @returns {boolean} True if at the bottom
   */
  function isAtBottom() {
    const scrollTop = window.scrollY;
    const scrollHeight = document.documentElement.scrollHeight;
    const clientHeight = window.innerHeight;

    // Allow 5px tolerance for rounding
    return scrollTop + clientHeight >= scrollHeight - 5;
  }

  /**
   * Sends a message to the service worker / popup
   * @param {object} message - The message object
   */
  function sendMessage(message) {
    try {
      chrome.runtime.sendMessage(message);
    } catch (e) {
      // Extension context may be invalidated — ignore
      console.warn('[ContactExtractor] Could not send message:', e.message);
    }
  }

  // ============================================================
  // FLOATING OVERLAY (visible on the page while scrolling)
  // ============================================================

  /** Reference to the overlay DOM element */
  let overlayEl = null;

  /**
   * Creates the floating status overlay on the page
   */
  function createOverlay() {
    // Remove any existing overlay
    removeOverlay();

    overlayEl = document.createElement('div');
    overlayEl.id = '__ce-overlay';
    overlayEl.innerHTML = `
      <div id="__ce-header">
        <span id="__ce-title">⚡ Contact Extractor</span>
        <span id="__ce-status">Starting...</span>
      </div>
      <div id="__ce-progress-wrap">
        <div id="__ce-progress-bar"></div>
      </div>
      <div id="__ce-stats">
        <div class="__ce-stat"><span id="__ce-scroll-pct">0%</span><span class="__ce-stat-label">Scroll</span></div>
        <div class="__ce-stat"><span id="__ce-contacts">0</span><span class="__ce-stat-label">Contacts</span></div>
        <div class="__ce-stat"><span id="__ce-emails">0</span><span class="__ce-stat-label">Emails</span></div>
        <div class="__ce-stat"><span id="__ce-phones">0</span><span class="__ce-stat-label">Phones</span></div>
      </div>
    `;

    // Inject styles using a <style> element (isolated naming to avoid conflicts)
    const style = document.createElement('style');
    style.id = '__ce-overlay-style';
    style.textContent = `
      #__ce-overlay {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 260px;
        background: linear-gradient(135deg, rgba(10,10,26,0.95), rgba(18,18,42,0.95));
        border: 1px solid rgba(0,212,255,0.25);
        border-radius: 14px;
        padding: 14px 16px;
        z-index: 2147483647;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
        color: #e2e8f0;
        box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 20px rgba(0,212,255,0.1);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        transition: opacity 0.3s ease, transform 0.3s ease;
        animation: __ce-slideIn 0.4s cubic-bezier(0.4,0,0.2,1);
      }
      @keyframes __ce-slideIn {
        from { opacity: 0; transform: translateY(20px) scale(0.95); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes __ce-slideOut {
        from { opacity: 1; transform: translateY(0) scale(1); }
        to   { opacity: 0; transform: translateY(20px) scale(0.9); }
      }
      #__ce-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 10px;
      }
      #__ce-title {
        font-size: 12px;
        font-weight: 700;
        background: linear-gradient(135deg, #00d4ff, #7c3aed);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }
      #__ce-status {
        font-size: 10px;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 10px;
        background: rgba(16,185,129,0.2);
        color: #34d399;
      }
      #__ce-status.paused {
        background: rgba(245,158,11,0.2);
        color: #fbbf24;
      }
      #__ce-status.completed {
        background: rgba(0,212,255,0.2);
        color: #00d4ff;
      }
      #__ce-status.stopped {
        background: rgba(239,68,68,0.2);
        color: #f87171;
      }
      #__ce-progress-wrap {
        height: 4px;
        background: rgba(255,255,255,0.08);
        border-radius: 2px;
        overflow: hidden;
        margin-bottom: 12px;
      }
      #__ce-progress-bar {
        height: 100%;
        width: 0%;
        background: linear-gradient(90deg, #00d4ff, #7c3aed, #10b981);
        border-radius: 2px;
        transition: width 0.5s ease;
      }
      #__ce-stats {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 6px;
        text-align: center;
      }
      .__ce-stat {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .__ce-stat span:first-child {
        font-size: 16px;
        font-weight: 700;
        color: #00d4ff;
      }
      .__ce-stat:nth-child(2) span:first-child { color: #a78bfa; }
      .__ce-stat:nth-child(3) span:first-child { color: #34d399; }
      .__ce-stat:nth-child(4) span:first-child { color: #fbbf24; }
      .__ce-stat-label {
        font-size: 9px;
        font-weight: 500;
        color: #64748b;
        text-transform: uppercase;
        letter-spacing: 0.03em;
      }
    `;

    document.documentElement.appendChild(style);
    document.documentElement.appendChild(overlayEl);
  }

  /**
   * Updates the floating overlay with current stats
   */
  function updateOverlay(state, percentage, totalContacts, emailCount, phoneCount) {
    if (!overlayEl) return;

    // Progress bar
    const bar = overlayEl.querySelector('#__ce-progress-bar');
    if (bar) bar.style.width = percentage + '%';

    // Scroll percentage
    const pct = overlayEl.querySelector('#__ce-scroll-pct');
    if (pct) pct.textContent = percentage + '%';

    // Contacts
    const contacts = overlayEl.querySelector('#__ce-contacts');
    if (contacts) contacts.textContent = totalContacts;

    // Emails
    const emails = overlayEl.querySelector('#__ce-emails');
    if (emails) emails.textContent = emailCount;

    // Phones
    const phones = overlayEl.querySelector('#__ce-phones');
    if (phones) phones.textContent = phoneCount;

    // Status badge
    const status = overlayEl.querySelector('#__ce-status');
    if (status) {
      status.className = '';
      switch (state) {
        case 'scrolling':
          status.textContent = '● Scrolling';
          break;
        case 'paused':
          status.textContent = '❚❚ Paused';
          status.classList.add('paused');
          break;
        case 'completed':
          status.textContent = '✓ Done';
          status.classList.add('completed');
          break;
        case 'stopped':
          status.textContent = '■ Stopped';
          status.classList.add('stopped');
          break;
        default:
          status.textContent = state;
      }
    }
  }

  /**
   * Removes the overlay from the page with a fade-out animation
   */
  function removeOverlay() {
    const existing = document.getElementById('__ce-overlay');
    if (existing) {
      existing.style.animation = '__ce-slideOut 0.3s ease forwards';
      setTimeout(() => existing.remove(), 300);
    }
    const style = document.getElementById('__ce-overlay-style');
    if (style) style.remove();
    overlayEl = null;
  }

  /**
   * Helper: count emails and phones in extracted contacts
   */
  function getOverlayCounts() {
    const emailCount = extractedContacts.filter(c => c.email).length;
    const phoneCount = extractedContacts.filter(c => c.phone).length;
    return { emailCount, phoneCount };
  }

  // ============================================================
  // CONTACT EXTRACTION
  // ============================================================

  /**
   * Scans the current page for contact information
   * Returns only NEW contacts (not seen before in this session)
   * @returns {object[]} Array of new contact objects
   */
  function scanForContacts() {
    const pageText = document.body?.innerText || '';
    const pageHtml = document.body?.innerHTML || '';
    const newContacts = [];

    // Extract all contact data types
    const emails = extractEmails(pageText);
    const rawPhones = settings.enablePhoneExtraction ? extractPhones(pageText) : [];
    const rawLinkedInUrls = extractLinkedInUrls(pageHtml);
    const rawWebsiteUrls = extractWebsiteUrls(pageHtml);
    const companyName = extractCompanyName(document);
    const personNames = extractPersonNames(document, emails);
    const sourceUrl = window.location.href;

    // Filter out already-seen phones, LinkedIn URLs, and websites
    // (the full page is re-scanned each scroll step, so we must dedup these too)
    const phones = rawPhones.filter(p => !seenPhones.has(p.replace(/\D/g, '')));
    const linkedInUrls = rawLinkedInUrls.filter(u => !seenLinkedIn.has(u.toLowerCase()));
    const websiteUrls = rawWebsiteUrls.filter(u => !seenWebsites.has(u.toLowerCase()));

    // Build contacts — email is the primary key
    for (const email of emails) {
      // Dedup check
      if (settings.ignoreDuplicates && seenEmails.has(email)) {
        continue;
      }

      seenEmails.add(email);

      const contact = {
        companyName: companyName || '',
        personName: personNames.get(email) || '',
        email: email,
        phone: '',
        website: '',
        linkedIn: '',
        sourceUrl: sourceUrl,
        timestamp: Date.now(),
      };

      // Try to associate a phone number (mark as seen to prevent re-extraction)
      if (phones.length > 0) {
        const phone = phones.shift();
        contact.phone = phone;
        seenPhones.add(phone.replace(/\D/g, ''));
      }

      // Try to associate a website
      if (websiteUrls.length > 0) {
        const website = websiteUrls.shift();
        contact.website = website;
        seenWebsites.add(website.toLowerCase());
      }

      // Try to associate a LinkedIn URL
      if (linkedInUrls.length > 0) {
        const linkedIn = linkedInUrls.shift();
        contact.linkedIn = linkedIn;
        seenLinkedIn.add(linkedIn.toLowerCase());
      }

      newContacts.push(contact);
    }

    // Also capture phone-only contacts (phones without emails)
    // These get a generated key based on phone number
    if (settings.enablePhoneExtraction) {
      for (const phone of phones) {
        const phoneDigits = phone.replace(/\D/g, '');
        const phoneKey = `phone:${phoneDigits}`;
        if (seenEmails.has(phoneKey) || seenPhones.has(phoneDigits)) continue;

        seenEmails.add(phoneKey);
        seenPhones.add(phoneDigits);

        const website = websiteUrls.length > 0 ? websiteUrls.shift() : '';
        const linkedIn = linkedInUrls.length > 0 ? linkedInUrls.shift() : '';
        if (website) seenWebsites.add(website.toLowerCase());
        if (linkedIn) seenLinkedIn.add(linkedIn.toLowerCase());

        newContacts.push({
          companyName: companyName || '',
          personName: '',
          email: '',
          phone: phone,
          website: website,
          linkedIn: linkedIn,
          sourceUrl: sourceUrl,
          timestamp: Date.now(),
        });
      }
    }

    return newContacts;
  }

  // ============================================================
  // AUTO-SCROLL ENGINE
  // ============================================================

  /**
   * Main scroll loop — scrolls the page and extracts contacts
   * Runs until bottom is reached, max attempts exceeded, or stopped
   */
  async function startScrolling() {
    scrollState = 'scrolling';
    lastScrollY = -1;
    unchangedScrollCount = 0;

    // Create the floating overlay so user can see progress on the page
    createOverlay();
    updateOverlay('scrolling', 0, 0, 0, 0);

    // Scroll to top first
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await sleep(500);

    // Initial extraction at top of page
    const initialContacts = scanForContacts();
    if (initialContacts.length > 0) {
      extractedContacts.push(...initialContacts);
      sendMessage({
        type: 'CONTACTS_FOUND',
        contacts: initialContacts,
        totalCount: extractedContacts.length,
      });
      const { emailCount, phoneCount } = getOverlayCounts();
      updateOverlay('scrolling', 0, extractedContacts.length, emailCount, phoneCount);
    }

    // Scroll loop
    while (scrollState === 'scrolling') {
      // Check if paused — wait until resumed or stopped
      while (scrollState === 'paused') {
        updateOverlay('paused', getScrollPercentage(), extractedContacts.length, getOverlayCounts().emailCount, getOverlayCounts().phoneCount);
        await sleep(200);
      }

      if (scrollState === 'stopped') break;

      // Record position before scroll
      const beforeY = window.scrollY;

      // Smooth scroll down
      window.scrollBy({
        top: settings.scrollSpeed,
        behavior: 'smooth',
      });

      // Wait for scroll animation + content to load
      await sleep(settings.pauseDuration);

      if (scrollState === 'stopped') break;

      // Check if scroll position changed
      const afterY = window.scrollY;

      if (Math.abs(afterY - beforeY) < 2) {
        unchangedScrollCount++;
        if (unchangedScrollCount >= settings.maxScrollAttempts) {
          // Reached the bottom — no more scrolling possible
          break;
        }
        // Wait a bit longer for potential lazy loading
        await sleep(1000);
        continue;
      } else {
        unchangedScrollCount = 0;
      }

      // Report scroll progress
      const pct = getScrollPercentage();
      sendMessage({
        type: 'SCROLL_PROGRESS',
        percentage: pct,
      });

      // Update floating overlay
      const { emailCount, phoneCount } = getOverlayCounts();
      updateOverlay('scrolling', pct, extractedContacts.length, emailCount, phoneCount);

      // Extract contacts from newly loaded content
      const newContacts = scanForContacts();
      if (newContacts.length > 0) {
        extractedContacts.push(...newContacts);
        sendMessage({
          type: 'CONTACTS_FOUND',
          contacts: newContacts,
          totalCount: extractedContacts.length,
        });
      }

      // Check if at bottom
      if (isAtBottom()) {
        unchangedScrollCount++;
        if (unchangedScrollCount >= settings.maxScrollAttempts) {
          break;
        }
      }
    }

    // Scroll complete
    const finalState = scrollState === 'stopped' ? 'stopped' : 'completed';
    scrollState = 'idle';

    // Update overlay to show final state, then auto-remove after 5 seconds
    const { emailCount, phoneCount } = getOverlayCounts();
    updateOverlay(finalState, getScrollPercentage(), extractedContacts.length, emailCount, phoneCount);
    setTimeout(() => removeOverlay(), 5000);

    sendMessage({
      type: 'SCROLL_COMPLETE',
      finalState: finalState,
      totalContacts: extractedContacts.length,
      percentage: getScrollPercentage(),
    });
  }

  // ============================================================
  // MESSAGE LISTENERS
  // ============================================================

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'START_SCROLL':
        // Apply settings from popup
        if (message.settings) {
          settings = { ...settings, ...message.settings };
        }

        // Reset state for new session
        seenEmails.clear();
        seenPhones.clear();
        seenLinkedIn.clear();
        seenWebsites.clear();
        extractedContacts.length = 0;
        scrollState = 'idle';

        // Load previously seen emails to avoid duplicates across sessions
        if (message.existingEmails && Array.isArray(message.existingEmails)) {
          for (const email of message.existingEmails) {
            seenEmails.add(email);
          }
        }

        // Start scrolling
        startScrolling();
        sendResponse({ status: 'started' });
        break;

      case 'PAUSE_SCROLL':
        if (scrollState === 'scrolling') {
          scrollState = 'paused';
          sendResponse({ status: 'paused' });
        } else {
          sendResponse({ status: 'not_scrolling' });
        }
        break;

      case 'RESUME_SCROLL':
        if (scrollState === 'paused') {
          scrollState = 'scrolling';
          sendResponse({ status: 'resumed' });
        } else {
          sendResponse({ status: 'not_paused' });
        }
        break;

      case 'STOP_SCROLL':
        scrollState = 'stopped';
        sendResponse({ status: 'stopped' });
        break;

      case 'GET_STATUS':
        sendResponse({
          status: scrollState,
          totalContacts: extractedContacts.length,
          percentage: getScrollPercentage(),
        });
        break;

      default:
        sendResponse({ status: 'unknown_message' });
    }

    return true; // Keep channel open for async sendResponse
  });

  // Announce that content script is ready
  sendMessage({ type: 'CONTENT_READY', url: window.location.href });
})();
