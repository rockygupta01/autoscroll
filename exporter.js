/**
 * exporter.js — CSV and XLSX export functionality
 * 
 * Generates export files from contact data without external libraries.
 * CSV uses BOM for Excel compatibility.
 * XLSX is built using a minimal Open XML implementation.
 */

// ============================================================
// CSV EXPORT
// ============================================================

/**
 * Exports contacts array to CSV format
 * @param {object[]} contacts - Array of contact objects
 * @returns {string} Data URL for the CSV file
 */
function exportToCSV(contacts) {
  if (!contacts || contacts.length === 0) {
    throw new Error('No contacts to export');
  }

  const headers = [
    'Company Name',
    'Person Name',
    'Email',
    'Mobile Number',
    'Website',
    'LinkedIn URL',
    'Source Page URL',
  ];

  const rows = contacts.map(contact => [
    escapeCsvField(contact.companyName || ''),
    escapeCsvField(contact.personName || ''),
    escapeCsvField(contact.email || ''),
    escapeCsvField(contact.phone || ''),
    escapeCsvField(contact.website || ''),
    escapeCsvField(contact.linkedIn || ''),
    escapeCsvField(contact.sourceUrl || ''),
  ]);

  // BOM for Excel UTF-8 compatibility
  const BOM = '\uFEFF';
  const csvContent = BOM + [
    headers.join(','),
    ...rows.map(row => row.join(',')),
  ].join('\r\n');

  // Create data URL
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
  return URL.createObjectURL(blob);
}

/**
 * Escapes a field for CSV — wraps in quotes if necessary
 * @param {string} field - The field value
 * @returns {string} Escaped field
 */
function escapeCsvField(field) {
  const str = String(field);
  // Wrap in double quotes if contains comma, quote, newline, or leading/trailing whitespace
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r') || str !== str.trim()) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ============================================================
// XLSX EXPORT
// ============================================================

/**
 * Exports contacts array to XLSX format
 * Uses a minimal Open XML (OOXML) implementation
 * @param {object[]} contacts - Array of contact objects
 * @returns {Promise<string>} Data URL for the XLSX file
 */
async function exportToXLSX(contacts) {
  if (!contacts || contacts.length === 0) {
    throw new Error('No contacts to export');
  }

  const headers = [
    'Company Name',
    'Person Name',
    'Email',
    'Mobile Number',
    'Website',
    'LinkedIn URL',
    'Source Page URL',
  ];

  const rows = contacts.map(contact => [
    contact.companyName || '',
    contact.personName || '',
    contact.email || '',
    contact.phone || '',
    contact.website || '',
    contact.linkedIn || '',
    contact.sourceUrl || '',
  ]);

  // Build shared strings table
  const allStrings = [...headers];
  for (const row of rows) {
    allStrings.push(...row);
  }

  // Create unique strings index
  const stringMap = new Map();
  const uniqueStrings = [];
  for (const str of allStrings) {
    if (!stringMap.has(str)) {
      stringMap.set(str, uniqueStrings.length);
      uniqueStrings.push(str);
    }
  }

  // Build XML files for XLSX
  const contentTypes = buildContentTypes();
  const rels = buildRels();
  const workbook = buildWorkbook();
  const workbookRels = buildWorkbookRels();
  const sharedStrings = buildSharedStrings(uniqueStrings);
  const styles = buildStyles();
  const sheet = buildSheet(headers, rows, stringMap);

  // Create ZIP using browser API
  const zipBlob = await createZip({
    '[Content_Types].xml': contentTypes,
    '_rels/.rels': rels,
    'xl/workbook.xml': workbook,
    'xl/_rels/workbook.xml.rels': workbookRels,
    'xl/sharedStrings.xml': sharedStrings,
    'xl/styles.xml': styles,
    'xl/worksheets/sheet1.xml': sheet,
  });

  return URL.createObjectURL(zipBlob);
}

// ---- XLSX XML Builders ----

function buildContentTypes() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;
}

function buildRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function buildWorkbook() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Contacts" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;
}

function buildWorkbookRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function buildSharedStrings(strings) {
  const items = strings
    .map(s => `<si><t>${escapeXml(s)}</t></si>`)
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">
${items}
</sst>`;
}

function buildStyles() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF4472C4"/></patternFill></fill>
  </fills>
  <borders count="1"><border/></borders>
  <cellStyleXfs count="1"><xf/></cellStyleXfs>
  <cellXfs count="2">
    <xf fontId="0" fillId="0" borderId="0"/>
    <xf fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1"/>
  </cellXfs>
</styleSheet>`;
}

function buildSheet(headers, rows, stringMap) {
  let sheetData = '';

  // Column letters
  const colLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

  // Header row (style index 1 = bold + blue background)
  sheetData += '<row r="1">';
  headers.forEach((h, i) => {
    const ref = `${colLetters[i]}1`;
    const idx = stringMap.get(h);
    sheetData += `<c r="${ref}" t="s" s="1"><v>${idx}</v></c>`;
  });
  sheetData += '</row>';

  // Data rows
  rows.forEach((row, rowIdx) => {
    const rowNum = rowIdx + 2;
    sheetData += `<row r="${rowNum}">`;
    row.forEach((cell, colIdx) => {
      const ref = `${colLetters[colIdx]}${rowNum}`;
      const idx = stringMap.get(cell);
      sheetData += `<c r="${ref}" t="s"><v>${idx}</v></c>`;
    });
    sheetData += '</row>';
  });

  // Column widths
  const colWidths = colLetters.map((_, i) => 
    `<col min="${i + 1}" max="${i + 1}" width="${i === 6 ? 40 : 20}" customWidth="1"/>`
  ).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>${colWidths}</cols>
  <sheetData>${sheetData}</sheetData>
</worksheet>`;
}

// ---- XML Helpers ----

/**
 * Escapes special XML characters
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ============================================================
// ZIP CREATOR (Minimal implementation)
// ============================================================

/**
 * Creates a ZIP file from a map of filename → content
 * Uses the DEFLATE-less STORE method for simplicity
 * @param {Object<string, string>} files - Map of file paths to content strings
 * @returns {Promise<Blob>} ZIP file as a Blob
 */
async function createZip(files) {
  const entries = Object.entries(files);
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const [name, content] of entries) {
    const nameBytes = new TextEncoder().encode(name);
    const contentBytes = new TextEncoder().encode(content);
    const crc = crc32(contentBytes);

    // Local file header (30 bytes + name + content)
    const localHeader = new Uint8Array(30 + nameBytes.length + contentBytes.length);
    const localView = new DataView(localHeader.buffer);

    // Local file header signature
    localView.setUint32(0, 0x04034b50, true);
    // Version needed
    localView.setUint16(4, 20, true);
    // Flags
    localView.setUint16(6, 0, true);
    // Compression method (0 = STORE)
    localView.setUint16(8, 0, true);
    // Mod time & date
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0, true);
    // CRC-32
    localView.setUint32(14, crc, true);
    // Compressed size
    localView.setUint32(18, contentBytes.length, true);
    // Uncompressed size
    localView.setUint32(22, contentBytes.length, true);
    // Filename length
    localView.setUint16(26, nameBytes.length, true);
    // Extra field length
    localView.setUint16(28, 0, true);
    // Filename
    localHeader.set(nameBytes, 30);
    // Content
    localHeader.set(contentBytes, 30 + nameBytes.length);

    localHeaders.push(localHeader);

    // Central directory header (46 bytes + name)
    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);

    // Central directory signature
    centralView.setUint32(0, 0x02014b50, true);
    // Version made by
    centralView.setUint16(4, 20, true);
    // Version needed
    centralView.setUint16(6, 20, true);
    // Flags
    centralView.setUint16(8, 0, true);
    // Compression method
    centralView.setUint16(10, 0, true);
    // Mod time & date
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0, true);
    // CRC-32
    centralView.setUint32(16, crc, true);
    // Compressed size
    centralView.setUint32(20, contentBytes.length, true);
    // Uncompressed size
    centralView.setUint32(24, contentBytes.length, true);
    // Filename length
    centralView.setUint16(28, nameBytes.length, true);
    // Extra field length
    centralView.setUint16(30, 0, true);
    // Comment length
    centralView.setUint16(32, 0, true);
    // Disk number start
    centralView.setUint16(34, 0, true);
    // Internal attributes
    centralView.setUint16(36, 0, true);
    // External attributes
    centralView.setUint32(38, 0, true);
    // Relative offset of local header
    centralView.setUint32(42, offset, true);
    // Filename
    centralHeader.set(nameBytes, 46);

    centralHeaders.push(centralHeader);
    offset += localHeader.length;
  }

  // End of central directory record
  const centralDirSize = centralHeaders.reduce((sum, h) => sum + h.length, 0);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);

  // End of central directory signature
  endView.setUint32(0, 0x06054b50, true);
  // Disk number
  endView.setUint16(4, 0, true);
  // Disk with central directory
  endView.setUint16(6, 0, true);
  // Entries on this disk
  endView.setUint16(8, entries.length, true);
  // Total entries
  endView.setUint16(10, entries.length, true);
  // Central directory size
  endView.setUint32(12, centralDirSize, true);
  // Central directory offset
  endView.setUint32(16, offset, true);
  // Comment length
  endView.setUint16(20, 0, true);

  // Combine all parts
  const parts = [...localHeaders, ...centralHeaders, endRecord];
  const blob = new Blob(parts, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  return blob;
}

/**
 * Computes CRC-32 checksum for a Uint8Array
 * @param {Uint8Array} bytes - Input bytes
 * @returns {number} CRC-32 checksum
 */
function crc32(bytes) {
  let crc = 0xFFFFFFFF;

  // Build CRC table
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }

  for (let i = 0; i < bytes.length; i++) {
    crc = table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  }

  return (crc ^ 0xFFFFFFFF) >>> 0;
}
