import express from 'express';
import ExcelJS from 'exceljs';
import { PERMISSIONS } from '../rbac.js';
import { requireTenantPermission } from '../middleware/permissions.js';
import { tenantIdFromReq } from '../utils/tenant.js';
import { csvEscape, exportRecordRows, recordExportRows } from '../services/importExportService.js';

export function createExportRouter({ analyticsApi }) {
  const router = express.Router();
router.get('/export/opportunities.csv', requireTenantPermission(PERMISSIONS.REPORTS_READ), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const rows = exportRecordRows(req, analyticsApi);
  const { headers, items } = recordExportRows(tenantId, rows);
  const lines = [headers.map(csvEscape).join(',')];
  for (const item of items) {
    lines.push(
      headers.map((header) => csvEscape(item[header] ?? '')).join(',')
    );
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="opportunities.csv"');
  res.send(lines.join('\n'));
});

router.get('/export/opportunities.xlsx', requireTenantPermission(PERMISSIONS.REPORTS_READ), async (req, res) => {
  const tenantId = tenantIdFromReq(req);
  try {
    const rows = exportRecordRows(req, analyticsApi);
    const { headers, items } = recordExportRows(tenantId, rows);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Record Export';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Records', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    sheet.addRow(headers);
    sheet.getRow(1).font = { bold: true };
    sheet.columns = headers.map((header) => ({
      key: header,
      width: Math.max(16, Math.min(36, header.length + 4)),
    }));
    for (const item of items) {
      sheet.addRow(headers.map((header) => item[header] ?? ''));
    }
    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename="records-export.xlsx"');
    res.send(Buffer.from(buffer));
  } catch (e) {
    res.status(500).json({ message: e instanceof Error ? e.message : 'Export failed' });
  }
});

router.get('/export/reports/pipeline-summary.csv', requireTenantPermission(PERMISSIONS.REPORTS_READ), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const summary = analyticsApi.buildPipelineSummary(tenantId, req.query);
  const lines = ['section,key,count,totalValue'];
  for (const row of summary.totalsByStatus) {
    lines.push(['by_status', csvEscape(row.status), row.count, row.totalValue].join(','));
  }
  for (const row of summary.countsByOwner) {
    lines.push(['by_owner', csvEscape(row.ownerId), row.count, row.totalValue].join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="pipeline-summary.csv"'
  );
  res.send(lines.join('\n'));
});
  return router;
}

