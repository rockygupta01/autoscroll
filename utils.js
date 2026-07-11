/**
 * utils.js — Shared utility functions for contact extraction
 * 
 * Contains regex patterns, validators, and extraction helpers
 * used by the content script to find contact information on webpages.
 */

// ============================================================
// REGEX PATTERNS
// ============================================================

/**
 * Email pattern — matches standard email formats
 * Excludes common false positives like image filenames (logo@2x.png)
 */
const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

/**
 * Phone number patterns — covers international and local formats
 * Matches: +1-234-567-8901, (234) 567-8901, 234.567.8901, +91 98765 43210, etc.
 */
const PHONE_PATTERNS = [
  /\+?\d{1,4}[\s\-.]?\(?\d{1,4}\)?[\s\-.]?\d{1,4}[\s\-.]?\d{1,9}/g,
  /\(\d{3}\)\s?\d{3}[\-.]?\d{4}/g,
  /\+\d{1,3}\s?\d{4,5}\s?\d{4,5}/g,
];

/**
 * LinkedIn profile URL pattern
 */
const LINKEDIN_REGEX = /https?:\/\/(www\.)?linkedin\.com\/in\/[a-zA-Z0-9_\-]+\/?/gi;

/**
 * Website URL pattern — matches http/https URLs
 */
const WEBSITE_REGEX = /https?:\/\/(?!.*linkedin\.com)[a-zA-Z0-9\-]+\.[a-zA-Z]{2,}[^\s"'<>)}\]]*?/gi;

// ============================================================
// FALSE POSITIVE FILTERS
// ============================================================

/** Common image/file-like email false positives */
const EMAIL_BLACKLIST_PATTERNS = [
  /@\d+x\./i,          // logo@2x.png
  /@media/i,            // CSS @media
  /@import/i,           // CSS @import
  /@keyframes/i,        // CSS @keyframes
  /@font-face/i,        // CSS @font-face
  /@charset/i,          // CSS @charset
  /@supports/i,         // CSS @supports
];

/** Domains to exclude from email extraction */
const EMAIL_DOMAIN_BLACKLIST = [
  'example.com',
  'test.com',
  'email.com',
  'domain.com',
  'yourcompany.com',
  'company.com',
  'sentry.io',
  'wixpress.com',
];

/** Common non-phone number patterns (years, zip codes, etc.) */
const PHONE_MIN_DIGITS = 7;
const PHONE_MAX_DIGITS = 15;

// ============================================================
// VALIDATORS
// ============================================================

/**
 * Validates an email address — filters out false positives
 * @param {string} email - The email string to validate
 * @returns {boolean} True if the email appears valid
 */
function isValidEmail(email) {
  if (!email || email.length < 5 || email.length > 254) return false;

  // Check against blacklist patterns
  for (const pattern of EMAIL_BLACKLIST_PATTERNS) {
    if (pattern.test(email)) return false;
  }

  // Check against blacklisted domains
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return false;
  if (EMAIL_DOMAIN_BLACKLIST.includes(domain)) return false;

  // Must have at least one dot in domain
  if (!domain.includes('.')) return false;

  // TLD must be at least 2 chars
  const tld = domain.split('.').pop();
  if (!tld || tld.length < 2) return false;

  return true;
}

/**
 * Validates a phone number — strict filtering to reduce false positives
 * @param {string} phone - The phone string to validate
 * @returns {boolean} True if the phone number appears valid
 */
function isValidPhone(phone) {
  if (!phone) return false;

  const trimmed = phone.trim();

  // Count digits only
  const digits = trimmed.replace(/\D/g, '');

  if (digits.length < PHONE_MIN_DIGITS || digits.length > PHONE_MAX_DIGITS) {
    return false;
  }

  // Reject if it looks like a year (4 digits standalone)
  if (digits.length === 4 && /^\d{4}$/.test(trimmed)) {
    return false;
  }

  // Reject strings that are just sequences of the same digit (e.g., 0000000)
  if (/^(\d)\1+$/.test(digits)) {
    return false;
  }

  // Reject likely pincodes / zip codes / ID numbers:
  // - Exactly 5 or 6 digits without any separators or prefix
  if ((digits.length === 5 || digits.length === 6) && /^\d+$/.test(trimmed)) {
    return false;
  }

  // For numbers WITHOUT a + prefix, require at least 10 digits
  if (!trimmed.startsWith('+') && digits.length < 10) {
    return false;
  }

  // Indian phone numbers: 10-digit numbers must start with 6, 7, 8, or 9
  if (digits.length === 10 && !/^[6-9]/.test(digits)) {
    return false;
  }

  // Reject numbers that look like "XXXXX-XXXXX" patterns typical of pincodes/IDs
  // (e.g., "78149-00856") — real phones rarely have a 5-5 split
  if (/^\d{5}-\d{5}$/.test(trimmed) && !/^[6-9]/.test(digits)) {
    return false;
  }

  // Reject sequential digits (12345678, 87654321)
  let isSequential = true;
  for (let i = 1; i < digits.length; i++) {
    if (Math.abs(parseInt(digits[i]) - parseInt(digits[i - 1])) !== 1) {
      isSequential = false;
      break;
    }
  }
  if (isSequential && digits.length >= 7) {
    return false;
  }

  return true;
}

// ============================================================
// EXTRACTION FUNCTIONS
// ============================================================

/**
 * Extracts unique valid emails from text
 * @param {string} text - The text to search
 * @returns {string[]} Array of unique valid email addresses
 */
function extractEmails(text) {
  if (!text) return [];

  const matches = text.match(EMAIL_REGEX) || [];
  const unique = new Set();

  for (const email of matches) {
    const normalized = email.toLowerCase().trim();
    if (isValidEmail(normalized)) {
      unique.add(normalized);
    }
  }

  return Array.from(unique);
}

/**
 * Extracts phone numbers from text
 * @param {string} text - The text to search
 * @returns {string[]} Array of unique valid phone numbers
 */
function extractPhones(text) {
  if (!text) return [];

  const allMatches = [];

  for (const pattern of PHONE_PATTERNS) {
    // Reset lastIndex for global regex
    pattern.lastIndex = 0;
    const matches = text.match(pattern) || [];
    allMatches.push(...matches);
  }

  const unique = new Set();
  for (const phone of allMatches) {
    const cleaned = phone.trim();
    if (isValidPhone(cleaned)) {
      // Normalize to digits-only for dedup, but keep original format
      const digits = cleaned.replace(/\D/g, '');
      if (!unique.has(digits)) {
        unique.add(digits);
      }
    }
  }

  // Return the original format versions
  const results = [];
  const seen = new Set();
  for (const phone of allMatches) {
    const cleaned = phone.trim();
    const digits = cleaned.replace(/\D/g, '');
    if (isValidPhone(cleaned) && !seen.has(digits)) {
      seen.add(digits);
      results.push(cleaned);
    }
  }

  return results;
}

/**
 * Extracts LinkedIn profile URLs from text
 * @param {string} text - The text to search
 * @returns {string[]} Array of unique LinkedIn profile URLs
 */
function extractLinkedInUrls(text) {
  if (!text) return [];

  LINKEDIN_REGEX.lastIndex = 0;
  const matches = text.match(LINKEDIN_REGEX) || [];
  const unique = new Set();

  for (const url of matches) {
    // Normalize: remove trailing slash, lowercase
    const normalized = url.toLowerCase().replace(/\/$/, '');
    unique.add(normalized);
  }

  return Array.from(unique);
}

/**
 * Extracts website URLs from anchor elements on the page
 * Filters out internal links, social media, and common non-contact URLs
 * @param {string} text - The page text/HTML to search
 * @returns {string[]} Array of unique website URLs
 */
function extractWebsiteUrls(text) {
  if (!text) return [];

  WEBSITE_REGEX.lastIndex = 0;
  const matches = text.match(WEBSITE_REGEX) || [];
  const unique = new Set();

  /** Domains to exclude from website extraction */
  const excludeDomains = [
    'google.com', 'facebook.com', 'twitter.com', 'instagram.com',
    'youtube.com', 'github.com', 'stackoverflow.com', 'w3.org',
    'jquery.com', 'googleapis.com', 'gstatic.com', 'cloudflare.com',
    'cdn.', 'fonts.', 'ajax.', 'maps.', 'schema.org',
  ];

  for (const url of matches) {
    const normalized = url.toLowerCase().replace(/\/$/, '');

    // Skip excluded domains
    const shouldExclude = excludeDomains.some(d => normalized.includes(d));
    if (shouldExclude) continue;

    // Skip if URL is too short or looks like an asset
    if (normalized.length < 10) continue;
    if (/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map)$/i.test(normalized)) continue;

    unique.add(normalized);
  }

  return Array.from(unique);
}

/**
 * Extracts company name from page metadata and DOM
 * Uses a hierarchy of sources for best accuracy
 * @param {Document} doc - The document object
 * @returns {string} The extracted company name, or empty string
 */
function extractCompanyName(doc) {
  // 1. Try Open Graph site_name
  const ogSiteName = doc.querySelector('meta[property="og:site_name"]');
  if (ogSiteName?.content) return ogSiteName.content.trim();

  // 2. Try schema.org Organization name
  const schemaScripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const script of schemaScripts) {
    try {
      const data = JSON.parse(script.textContent);
      if (data['@type'] === 'Organization' && data.name) {
        return data.name.trim();
      }
      // Handle arrays of schema objects
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item['@type'] === 'Organization' && item.name) {
            return item.name.trim();
          }
        }
      }
    } catch (e) {
      // JSON parse error — skip
    }
  }

  // 3. Try meta application-name
  const appName = doc.querySelector('meta[name="application-name"]');
  if (appName?.content) return appName.content.trim();

  // 4. Fall back to document title (first part before separator)
  const title = doc.title;
  if (title) {
    // Split on common separators and take the first meaningful part
    const parts = title.split(/[\|–—\-:]/);
    if (parts.length > 1) {
      return parts[0].trim();
    }
    return title.trim();
  }

  return '';
}

/**
 * Attempts to extract person names near email addresses
 * Uses proximity heuristics — looks for text patterns near emails
 * @param {Document} doc - The document object
 * @param {string[]} emails - Emails found on the page
 * @returns {Map<string, string>} Map of email → person name
 */
function extractPersonNames(doc, emails) {
  const nameMap = new Map();
  const bodyText = doc.body?.innerText || '';

  for (const email of emails) {
    // Find the email in the page text and look at surrounding context
    const emailIndex = bodyText.toLowerCase().indexOf(email.toLowerCase());
    if (emailIndex === -1) continue;

    // Get surrounding text (200 chars before and after)
    const start = Math.max(0, emailIndex - 200);
    const end = Math.min(bodyText.length, emailIndex + email.length + 200);
    const context = bodyText.substring(start, end);

    // Try common name patterns near the email
    const namePatterns = [
      // "Name: John Doe" or "Contact: Jane Smith"
      /(?:name|contact|by|author|from)\s*[:]\s*([A-Z][a-z]+ [A-Z][a-z]+)/i,
      // Capitalized two-word name on its own line before the email
      /^([A-Z][a-z]{1,20}\s+[A-Z][a-z]{1,20})\s*$/m,
      // "John Doe <email>" or "John Doe - email"
      /([A-Z][a-z]{1,20}\s+[A-Z][a-z]{1,20})\s*(?:[<\-–—|])/,
    ];

    for (const pattern of namePatterns) {
      const match = context.match(pattern);
      if (match?.[1]) {
        const name = match[1].trim();
        // Basic validation: 2+ chars per word, not common non-name words
        const words = name.split(/\s+/);
        const nonNames = ['the', 'and', 'for', 'our', 'your', 'this', 'that', 'about', 'contact'];
        const isValid = words.length >= 2
          && words.every(w => w.length >= 2)
          && !words.some(w => nonNames.includes(w.toLowerCase()));

        if (isValid) {
          nameMap.set(email, name);
          break;
        }
      }
    }
  }

  return nameMap;
}
