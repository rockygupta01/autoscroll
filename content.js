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
    const phones = settings.enablePhoneExtraction ? extractPhones(pageText) : [];
    const linkedInUrls = extractLinkedInUrls(pageHtml);
    const websiteUrls = extractWebsiteUrls(pageHtml);
    const companyName = extractCompanyName(document);
    const personNames = extractPersonNames(document, emails);
    const sourceUrl = window.location.href;

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

      // Try to associate a phone number
      if (phones.length > 0) {
        contact.phone = phones.shift(); // Associate and remove from pool
      }

      // Try to associate a website
      if (websiteUrls.length > 0) {
        contact.website = websiteUrls.shift(); // Associate and remove from pool
      }

      // Try to associate a LinkedIn URL
      if (linkedInUrls.length > 0) {
        contact.linkedIn = linkedInUrls.shift(); // Associate and remove from pool
      }

      newContacts.push(contact);
    }

    // Also capture phone-only contacts (phones without emails)
    // These get a generated key based on phone number
    if (settings.enablePhoneExtraction) {
      for (const phone of phones) {
        const phoneKey = `phone:${phone.replace(/\D/g, '')}`;
        if (seenEmails.has(phoneKey)) continue;

        seenEmails.add(phoneKey);

        newContacts.push({
          companyName: companyName || '',
          personName: '',
          email: '',
          phone: phone,
          website: websiteUrls.length > 0 ? websiteUrls.shift() : '',
          linkedIn: linkedInUrls.length > 0 ? linkedInUrls.shift() : '',
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
    }

    // Scroll loop
    while (scrollState === 'scrolling') {
      // Check if paused — wait until resumed or stopped
      while (scrollState === 'paused') {
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
      sendMessage({
        type: 'SCROLL_PROGRESS',
        percentage: getScrollPercentage(),
      });

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
