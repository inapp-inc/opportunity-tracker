export type PrintReportFilter = {
  label: string;
  value: string;
};

export type PrintReportTable = {
  headers: string[];
  rows: string[][];
};

export type PrintReportSection = {
  title: string;
  table?: PrintReportTable;
  emptyMessage?: string;
};

export type PrintReportDocument = {
  title: string;
  subtitle?: string;
  generatedAt: string;
  filters: PrintReportFilter[];
  sections: PrintReportSection[];
};

function escapeHtml(value: string) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderTable(table: PrintReportTable) {
  const head = table.headers
    .map((h) => `<th>${escapeHtml(h)}</th>`)
    .join("");
  const body = table.rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`
    )
    .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderSection(section: PrintReportSection, index: number) {
  const pageBreak = index > 0 && index % 2 === 0 ? " page-break" : "";
  let body = "";
  if (section.table && section.table.rows.length) {
    body = renderTable(section.table);
  } else {
    body = `<p class="empty">${escapeHtml(
      section.emptyMessage || "No data for the selected filters."
    )}</p>`;
  }
  return `
    <section class="report-section${pageBreak}">
      <h2>${escapeHtml(section.title)}</h2>
      ${body}
    </section>
  `;
}

export function buildReportPrintHtml(doc: PrintReportDocument) {
  const filterRows = doc.filters.length
    ? doc.filters
        .map(
          (f) =>
            `<tr><th>${escapeHtml(f.label)}</th><td>${escapeHtml(f.value)}</td></tr>`
        )
        .join("")
    : `<tr><td colspan="2">All records (no filters applied)</td></tr>`;

  const sections = doc.sections.map(renderSection).join("");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(doc.title)}</title>
    <style>
      @page { size: A4 portrait; margin: 14mm; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 0;
        font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
        font-size: 11pt;
        line-height: 1.45;
        color: #111827;
        background: #ffffff;
      }
      .doc { max-width: 100%; }
      header {
        border-bottom: 2px solid #2563eb;
        padding-bottom: 12px;
        margin-bottom: 20px;
      }
      h1 {
        margin: 0 0 4px;
        font-size: 22pt;
        font-weight: 700;
        color: #0f172a;
      }
      .subtitle {
        margin: 0 0 8px;
        color: #475569;
        font-size: 11pt;
      }
      .meta {
        font-size: 9pt;
        color: #64748b;
      }
      .filters {
        margin-bottom: 24px;
        padding: 12px 14px;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        background: #f8fafc;
      }
      .filters h2 {
        margin: 0 0 8px;
        font-size: 11pt;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #475569;
      }
      .filters table { margin: 0; }
      .filters th {
        width: 34%;
        font-weight: 600;
        color: #334155;
      }
      .report-section {
        margin-bottom: 22px;
        padding: 14px 16px;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .report-section.page-break {
        break-before: page;
        page-break-before: always;
      }
      .report-section h2 {
        margin: 0 0 12px;
        font-size: 13pt;
        color: #0f172a;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 10pt;
      }
      th, td {
        border: 1px solid #e2e8f0;
        padding: 7px 10px;
        text-align: left;
        vertical-align: top;
      }
      thead th {
        background: #f1f5f9;
        font-weight: 600;
        color: #0f172a;
      }
      tbody tr:nth-child(even) td { background: #fafafa; }
      .empty {
        margin: 0;
        padding: 16px;
        text-align: center;
        color: #64748b;
        font-style: italic;
      }
      @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }
    </style>
  </head>
  <body>
    <div class="doc">
      <header>
        <h1>${escapeHtml(doc.title)}</h1>
        ${doc.subtitle ? `<p class="subtitle">${escapeHtml(doc.subtitle)}</p>` : ""}
        <p class="meta">Generated ${escapeHtml(doc.generatedAt)}</p>
      </header>
      <div class="filters">
        <h2>Applied filters</h2>
        <table>
          <tbody>${filterRows}</tbody>
        </table>
      </div>
      ${sections}
    </div>
    <script>
      window.addEventListener("load", function () {
        setTimeout(function () { window.print(); }, 300);
      });
      window.addEventListener("afterprint", function () { window.close(); });
    </script>
  </body>
</html>`;
}

export function printReportDocument(doc: PrintReportDocument) {
  const html = buildReportPrintHtml(doc);
  const printWindow = window.open("", "_blank", "noopener,noreferrer,width=1024,height=768");
  if (!printWindow) {
    throw new Error("Pop-up blocked. Allow pop-ups for this site to print the report.");
  }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}
