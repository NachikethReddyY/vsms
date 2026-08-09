const PDFDocument = require("pdfkit");

const DATASET_TABLES = Object.freeze({
  OVERVIEW: ["registrations", "queue", "stations"],
  OPERATIONS: ["queue", "stations"],
  CLINICAL: ["screening", "reviews"],
  REFERRALS: ["referrals"],
});

function protectSpreadsheetCell(value) {
  const text = value == null ? "" : String(value);
  return /^[\u0000-\u0020]*[=+\-@]/.test(text) ? `'${text}` : text;
}

const quoteCsv = (value) => `"${protectSpreadsheetCell(value).replace(/"/g, '""')}"`;

function selectedTables(analytics, dataset) {
  const ids = new Set(DATASET_TABLES[dataset] || DATASET_TABLES.OVERVIEW);
  return analytics.tables.filter(({ id }) => ids.has(id));
}

function renderCsv(analytics, dataset) {
  const rows = [["dataset", "table", "dimension", "metric", "value", "suppressed"]];
  for (const reportTable of selectedTables(analytics, dataset)) {
    for (const [rowIndex, row] of reportTable.rows.entries()) {
      for (const column of reportTable.columns) {
        rows.push([dataset, reportTable.title, String(rowIndex + 1), column.label, row[column.key], row.suppressed === true]);
      }
    }
  }
  return Buffer.from(`${rows.map((row) => row.map(quoteCsv).join(",")).join("\r\n")}\r\n`, "utf8");
}

function ensurePage(doc, height = 60) {
  if (doc.y + height > doc.page.height - 54) doc.addPage();
}

function renderPdf(analytics, dataset) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 54, info: { Title: `${analytics.event.name} aggregate report`, Author: "VSMS", Subject: `${dataset} aggregate analytics` } });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.fontSize(20).fillColor("#111827").text(analytics.event.name);
    doc.moveDown(0.3).fontSize(10).fillColor("#4b5563").text(`${dataset} aggregate report | Generated ${analytics.generatedAt}`);
    doc.text(`Applied interval: ${analytics.timeBasis.from} to ${analytics.timeBasis.to} (${analytics.timeBasis.interval}, UTC; display zone ${analytics.event.timezone})`);
    doc.text(`Small-cell rule: ${analytics.smallCellSuppression.rule}`);
    doc.moveDown();
    doc.fontSize(14).fillColor("#111827").text("Observations");
    for (const observation of analytics.observations) doc.fontSize(10).text(`- ${observation}`);
    for (const reportTable of selectedTables(analytics, dataset)) {
      ensurePage(doc, 100);
      doc.moveDown().fontSize(14).fillColor("#111827").text(reportTable.title);
      if (!reportTable.rows.length) {
        doc.fontSize(9).fillColor("#6b7280").text("No aggregate rows.");
        continue;
      }
      for (const row of reportTable.rows) {
        ensurePage(doc, 34);
        const line = reportTable.columns.map((column) => `${column.label}: ${row[column.key] == null ? (row.suppressed ? "suppressed" : "n/a") : row[column.key]}`).join(" | ");
        doc.fontSize(8).fillColor("#1f2937").text(line, { width: 487 });
        const numeric = reportTable.columns.map(({ key }) => Number(row[key])).find((value) => Number.isFinite(value) && value > 0);
        if (numeric) {
          doc.save().fillColor("#2563eb").rect(doc.x, doc.y + 2, Math.min(220, numeric * 4), 3).fill().restore();
          doc.moveDown(0.4);
        }
      }
    }
    ensurePage(doc, 100);
    doc.moveDown().fontSize(14).fillColor("#111827").text("Metric definitions");
    for (const definition of analytics.metricDefinitions) {
      ensurePage(doc, 32);
      doc.fontSize(8).text(`${definition.label} (${definition.unit}): ${definition.definition}`);
    }
    doc.end();
  });
}

async function renderReport(analytics, dataset, format) {
  if (format === "CSV") return { contents: renderCsv(analytics, dataset), mimeType: "text/csv; charset=utf-8" };
  return { contents: await renderPdf(analytics, dataset), mimeType: "application/pdf" };
}

module.exports = { DATASET_TABLES, protectSpreadsheetCell, quoteCsv, renderCsv, renderPdf, renderReport, selectedTables };
