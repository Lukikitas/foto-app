/**
 * Zero-dependency OpenXML (.xlsx) Workbook Generator & Exporter
 * Generates native, multi-sheet Excel files with formatting, borders,
 * custom styles, auto-column widths, and auto-filters.
 */

// CRC32 table calculation
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c;
}

function crc32(bytes) {
  let crc = 0 ^ -1;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function dateToDosTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/**
 * Creates a valid PKZip archive containing the given files array [{ name, data }].
 * Data can be a string (UTF-8) or Uint8Array.
 * Uses method 0 (STORE) for 100% universal compatibility and zero external dependencies.
 */
function createZip(files) {
  const encoder = new TextEncoder();
  const encodedFiles = files.map((file) => {
    const dataBytes = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
    const nameBytes = encoder.encode(file.name);
    const checksum = crc32(dataBytes);
    return {
      name: file.name,
      nameBytes,
      dataBytes,
      crc: checksum,
      size: dataBytes.length,
    };
  });

  const { time: dosTime, date: dosDate } = dateToDosTime();

  // Calculate total buffer size
  let localHeadersSize = 0;
  let centralDirSize = 0;
  encodedFiles.forEach((file) => {
    localHeadersSize += 30 + file.nameBytes.length + file.size;
    centralDirSize += 46 + file.nameBytes.length;
  });
  const eocdSize = 22;
  const totalSize = localHeadersSize + centralDirSize + eocdSize;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  let offset = 0;
  const localOffsets = [];

  // Write Local File Headers & Data
  encodedFiles.forEach((file) => {
    localOffsets.push(offset);

    // Signature 0x04034b50
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true); // Version needed
    view.setUint16(offset + 6, 0x0800, true); // UTF-8 filename flag
    view.setUint16(offset + 8, 0, true); // Compression: 0 = STORE
    view.setUint16(offset + 10, dosTime, true);
    view.setUint16(offset + 12, dosDate, true);
    view.setUint32(offset + 14, file.crc, true);
    view.setUint32(offset + 18, file.size, true); // Compressed size
    view.setUint32(offset + 22, file.size, true); // Uncompressed size
    view.setUint16(offset + 26, file.nameBytes.length, true);
    view.setUint16(offset + 28, 0, true); // Extra field length

    offset += 30;
    bytes.set(file.nameBytes, offset);
    offset += file.nameBytes.length;
    bytes.set(file.dataBytes, offset);
    offset += file.size;
  });

  const centralDirStartOffset = offset;

  // Write Central Directory Headers
  encodedFiles.forEach((file, idx) => {
    // Signature 0x02014b50
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, 20, true); // Version made by
    view.setUint16(offset + 6, 20, true); // Version needed
    view.setUint16(offset + 8, 0x0800, true); // UTF-8 flag
    view.setUint16(offset + 10, 0, true); // Compression: STORE
    view.setUint16(offset + 12, dosTime, true);
    view.setUint16(offset + 14, dosDate, true);
    view.setUint32(offset + 16, file.crc, true);
    view.setUint32(offset + 20, file.size, true);
    view.setUint32(offset + 24, file.size, true);
    view.setUint16(offset + 28, file.nameBytes.length, true);
    view.setUint16(offset + 30, 0, true); // Extra field len
    view.setUint16(offset + 32, 0, true); // Comment len
    view.setUint16(offset + 34, 0, true); // Disk start
    view.setUint16(offset + 36, 0, true); // Internal attributes
    view.setUint32(offset + 38, 0, true); // External attributes
    view.setUint32(offset + 42, localOffsets[idx], true); // Local header offset

    offset += 46;
    bytes.set(file.nameBytes, offset);
    offset += file.nameBytes.length;
  });

  const centralDirEndOffset = offset;
  const centralDirLength = centralDirEndOffset - centralDirStartOffset;

  // End of Central Directory Record (EOCD)
  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 4, 0, true); // Disk number
  view.setUint16(offset + 6, 0, true); // Start disk
  view.setUint16(offset + 8, encodedFiles.length, true); // Entries on disk
  view.setUint16(offset + 10, encodedFiles.length, true); // Total entries
  view.setUint32(offset + 12, centralDirLength, true); // Size of central dir
  view.setUint32(offset + 16, centralDirStartOffset, true); // Offset of central dir
  view.setUint16(offset + 20, 0, true); // Comment length

  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function xmlEscape(val) {
  if (val == null) return '';
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function colToLetter(index) {
  let temp = index;
  let letter = '';
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

/**
 * Predefined cell style identifiers:
 * 0: General / Normal text
 * 1: Text with border
 * 2: Table Header (Dark Navy fill #1E293B, white bold, border, centered/left)
 * 3: Red Accent Header (Crimson fill #E4002B, white bold, border)
 * 4: Number integer (numFmt 3: #,##0, border, right)
 * 5: Currency (numFmt 164: "$ "#,##0.00, border, right)
 * 6: Currency Integer (numFmt 166: "$ "#,##0, border, right)
 * 7: Percentage (numFmt 165: "0.0%", border, right)
 * 8: Text centered (border, center)
 * 9: Title 14pt bold (no border)
 * 10: Subtitle 9pt italic (no border, gray)
 * 11: Total Row Label (bold, double bottom border)
 * 12: Total Row Currency (bold, double bottom border, currency)
 * 13: Total Row Integer (bold, double bottom border, number)
 * 14: Total Row Percentage (bold, double bottom border, pct)
 * 15: KPI Card Title (gray 9pt, soft gray fill #F1F5F9, border, center)
 * 16: KPI Card Value Bold (13pt bold, soft gray fill #F1F5F9, border, center)
 * 17: Positive / Good Badge (soft green fill #DCFCE7, green bold text, border)
 * 18: Negative / Bad Badge (soft red fill #FEE2E2, red bold text, border)
 */
export const CELL_STYLES = {
  NORMAL: 0,
  TEXT_BORDER: 1,
  HEADER: 2,
  HEADER_RED: 3,
  INTEGER: 4,
  CURRENCY: 5,
  CURRENCY_INT: 6,
  PERCENT: 7,
  CENTER: 8,
  TITLE: 9,
  SUBTITLE: 10,
  TOTAL_LABEL: 11,
  TOTAL_CURRENCY: 12,
  TOTAL_INT: 13,
  TOTAL_PERCENT: 14,
  KPI_TITLE: 15,
  KPI_VALUE: 16,
  BADGE_GOOD: 17,
  BADGE_BAD: 18,
};

function buildStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="3">
    <numFmt numFmtId="164" formatCode="&quot;$&quot;\ #,##0.00"/>
    <numFmt numFmtId="165" formatCode="0.0%"/>
    <numFmt numFmtId="166" formatCode="&quot;$&quot;\ #,##0"/>
  </numFmts>
  <fonts count="7">
    <!-- 0: Normal -->
    <font><sz val="10"/><name val="Segoe UI"/><color rgb="FF1E293B"/></font>
    <!-- 1: Bold -->
    <font><b/><sz val="10"/><name val="Segoe UI"/><color rgb="FF0F172A"/></font>
    <!-- 2: White Bold Header -->
    <font><b/><sz val="10"/><name val="Segoe UI"/><color rgb="FFFFFFFF"/></font>
    <!-- 3: Big Title Bold 14pt -->
    <font><b/><sz val="14"/><name val="Segoe UI"/><color rgb="FF0F172A"/></font>
    <!-- 4: Subtitle Italic Gray -->
    <font><i/><sz val="9"/><name val="Segoe UI"/><color rgb="FF64748B"/></font>
    <!-- 5: Positive Green -->
    <font><b/><sz val="10"/><name val="Segoe UI"/><color rgb="FF166534"/></font>
    <!-- 6: Negative Red -->
    <font><b/><sz val="10"/><name val="Segoe UI"/><color rgb="FF991B1B"/></font>
  </fonts>
  <fills count="7">
    <!-- 0 & 1: Required defaults -->
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <!-- 2: Dark Navy Header #1E293B -->
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E293B"/><bgColor indexed="64"/></patternFill></fill>
    <!-- 3: Crimson Header #E4002B -->
    <fill><patternFill patternType="solid"><fgColor rgb="FFE4002B"/><bgColor indexed="64"/></patternFill></fill>
    <!-- 4: Soft Gray #F1F5F9 -->
    <fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill>
    <!-- 5: Light Green #DCFCE7 -->
    <fill><patternFill patternType="solid"><fgColor rgb="FFDCFCE7"/><bgColor indexed="64"/></patternFill></fill>
    <!-- 6: Light Red #FEE2E2 -->
    <fill><patternFill patternType="solid"><fgColor rgb="FFFEE2E2"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="3">
    <!-- 0: None -->
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <!-- 1: Thin light gray border -->
    <border>
      <left style="thin"><color rgb="FFE2E8F0"/></left>
      <right style="thin"><color rgb="FFE2E8F0"/></right>
      <top style="thin"><color rgb="FFE2E8F0"/></top>
      <bottom style="thin"><color rgb="FFE2E8F0"/></bottom>
      <diagonal/>
    </border>
    <!-- 2: Total row border (top thin, bottom double) -->
    <border>
      <left/><right/>
      <top style="thin"><color rgb="FF94A3B8"/></top>
      <bottom style="double"><color rgb="FF0F172A"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="19">
    <!-- 0: NORMAL -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <!-- 1: TEXT_BORDER -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
    <!-- 2: HEADER -->
    <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center" wrapText="1"/>
    </xf>
    <!-- 3: HEADER_RED -->
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center" wrapText="1"/>
    </xf>
    <!-- 4: INTEGER -->
    <xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <!-- 5: CURRENCY -->
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <!-- 6: CURRENCY_INT -->
    <xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <!-- 7: PERCENT -->
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <!-- 8: CENTER -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
    <!-- 9: TITLE -->
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <!-- 10: SUBTITLE -->
    <xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <!-- 11: TOTAL_LABEL -->
    <xf numFmtId="0" fontId="1" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1"/>
    <!-- 12: TOTAL_CURRENCY -->
    <xf numFmtId="164" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <!-- 13: TOTAL_INT -->
    <xf numFmtId="3" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <!-- 14: TOTAL_PERCENT -->
    <xf numFmtId="165" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <!-- 15: KPI_TITLE -->
    <xf numFmtId="0" fontId="4" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
    <!-- 16: KPI_VALUE -->
    <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
    <!-- 17: BADGE_GOOD -->
    <xf numFmtId="0" fontId="5" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
    <!-- 18: BADGE_BAD -->
    <xf numFmtId="0" fontId="6" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
  </cellXfs>
</styleSheet>`;
}

function buildSheetXml(sheet) {
  const { rows = [], colWidths = [], autoFilter = null, merges = [] } = sheet;

  // Auto-calculate column widths if not explicitly provided
  const maxLengths = [];
  rows.forEach((row) => {
    (row.cells || []).forEach((cell, colIdx) => {
      const len = String(cell?.value ?? '').length;
      if (!maxLengths[colIdx] || len > maxLengths[colIdx]) {
        maxLengths[colIdx] = len;
      }
    });
  });

  const colsXml = maxLengths.length
    ? `<cols>${maxLengths
        .map((maxLen, idx) => {
          const width = colWidths[idx] || Math.max(10, Math.min(45, maxLen + 4));
          const colNum = idx + 1;
          return `<col min="${colNum}" max="${colNum}" width="${width}" customWidth="1"/>`;
        })
        .join('')}</cols>`
    : '';

  let sheetDataXml = '<sheetData>';
  rows.forEach((row, rowIdx) => {
    const rNum = rowIdx + 1;
    const rowHeightAttr = row.height ? ` ht="${row.height}" customHeight="1"` : '';
    sheetDataXml += `<row r="${rNum}"${rowHeightAttr}>`;

    (row.cells || []).forEach((cell, colIdx) => {
      if (!cell) return;
      const cellRef = `${colToLetter(colIdx)}${rNum}`;
      const styleAttr = cell.style != null ? ` s="${cell.style}"` : '';

      if (cell.formula) {
        sheetDataXml += `<c r="${cellRef}"${styleAttr}><f>${xmlEscape(cell.formula)}</f>`;
        if (cell.value != null) {
          sheetDataXml += `<v>${cell.value}</v>`;
        }
        sheetDataXml += `</c>`;
      } else if (typeof cell.value === 'number') {
        sheetDataXml += `<c r="${cellRef}"${styleAttr}><v>${cell.value}</v></c>`;
      } else if (cell.value != null && cell.value !== '') {
        sheetDataXml += `<c r="${cellRef}" t="inlineStr"${styleAttr}><is><t>${xmlEscape(
          cell.value,
        )}</t></is></c>`;
      } else if (cell.style != null) {
        // Empty styled cell
        sheetDataXml += `<c r="${cellRef}"${styleAttr}/>`;
      }
    });

    sheetDataXml += '</row>';
  });
  sheetDataXml += '</sheetData>';

  const autoFilterXml = autoFilter ? `<autoFilter ref="${autoFilter}"/>` : '';
  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges
        .map((ref) => `<mergeCell ref="${ref}"/>`)
        .join('')}</mergeCells>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews>
    <sheetView workbookViewId="0" showGridLines="1"/>
  </sheetViews>
  ${colsXml}
  ${sheetDataXml}
  ${autoFilterXml}
  ${mergeXml}
</worksheet>`;
}

function buildContentTypesXml(sheetsCount) {
  let overrides = `
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`;
  for (let i = 1; i <= sheetsCount; i++) {
    overrides += `
  <Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${overrides}
</Types>`;
}

function buildRootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function buildWorkbookRelsXml(sheetsCount) {
  let rels = `
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
  for (let i = 1; i <= sheetsCount; i++) {
    rels += `
  <Relationship Id="rId${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i}.xml"/>`;
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${rels}
</Relationships>`;
}

function buildWorkbookXml(sheets) {
  const sheetsXml = sheets
    .map((sheet, idx) => {
      const id = idx + 1;
      const cleanName = (sheet.name || `Hoja ${id}`).replace(/[:\\/?*\[\]]/g, ' ').slice(0, 31);
      return `<sheet name="${xmlEscape(cleanName)}" sheetId="${id}" r:id="rId${id}"/>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${sheetsXml}
  </sheets>
</workbook>`;
}

/**
 * Builds a complete .xlsx Blob from a workbook definition:
 * {
 *   sheets: [
 *     {
 *       name: 'Resumen',
 *       colWidths: [20, 15, ...],
 *       autoFilter: 'A1:E20',
 *       merges: ['A1:D1'],
 *       rows: [
 *         { height: 25, cells: [{ value: 'Título', style: CELL_STYLES.TITLE }] },
 *         ...
 *       ]
 *     }
 *   ]
 * }
 */
export function generateXlsxBlob(workbook) {
  const sheets = workbook.sheets || [];
  if (!sheets.length) {
    throw new Error('El libro debe tener al menos una hoja.');
  }

  const files = [
    { name: '[Content_Types].xml', data: buildContentTypesXml(sheets.length) },
    { name: '_rels/.rels', data: buildRootRelsXml() },
    { name: 'xl/_rels/workbook.xml.rels', data: buildWorkbookRelsXml(sheets.length) },
    { name: 'xl/workbook.xml', data: buildWorkbookXml(sheets) },
    { name: 'xl/styles.xml', data: buildStylesXml() },
  ];

  sheets.forEach((sheet, idx) => {
    files.push({
      name: `xl/worksheets/sheet${idx + 1}.xml`,
      data: buildSheetXml(sheet),
    });
  });

  return createZip(files);
}

/**
 * Direct file download helper for binary Blobs.
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
