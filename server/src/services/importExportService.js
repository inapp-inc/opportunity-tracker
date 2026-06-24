import ExcelJS from 'exceljs';
import { db } from '../db.js';
import { DEFAULT_TENANT_ID } from '../constants.js';
import { csvEscape, formatExportCell } from '../utils/csv.js';
import { tenantIdFromReq } from '../utils/tenant.js';
import {
  activeSystemRecordFields,
  recordFieldDbColumn,
  recordSchemaFieldOptions,
  getRecordSchemaDefinitions,
  getTenantFieldDefinitions,
  RECORD_IMPORT_FIELD_EXCLUDE,
  validateImportLookupValue,
} from './schemaService.js';
import { importColumnTypeForField, isSchemaChoiceFieldType, isSchemaMultiChoiceFieldType } from '../schemaChoices.js';
import { defaultDealStage, mapOpportunityRow, createOpportunityRecord } from './opportunityService.js';

export function recordImportHeaders(tenantId = DEFAULT_TENANT_ID) {
  return recordImportColumns(tenantId).map((column) => column.header);
}

export function recordImportColumns(tenantId = DEFAULT_TENANT_ID) {
  const ownerEmails = db
    .prepare(
      `SELECT u.email
       FROM users u
       JOIN tenant_memberships tm ON tm.user_id = u.id
       WHERE tm.tenant_id = ? AND tm.status = 'ACTIVE' AND u.status = 'ACTIVE'
       ORDER BY u.email`
    )
    .all(tenantId)
    .map((user) => user.email);

  const columns = [];
  for (const field of activeSystemRecordFields(tenantId)) {
    if (RECORD_IMPORT_FIELD_EXCLUDE.has(field.key)) continue;
    if (field.key === 'ownerIds') {
      columns.push({
        header: 'owner_emails',
        required: field.required,
        type: 'lookup',
        options: ownerEmails,
      });
      continue;
    }
    const header = recordFieldDbColumn(field.key);
    columns.push({
      header,
      required: field.required,
      type: importColumnTypeForField(field.fieldType),
      options: recordSchemaFieldOptions(tenantId, field.key),
    });
  }

  const customFields = getRecordSchemaDefinitions(tenantId).filter(
    (field) => field.source === 'custom' && field.status !== 'INACTIVE'
  );
  for (const field of customFields) {
    columns.push({
      header: `custom.${field.key}`,
      required: field.required,
      type: importColumnTypeForField(field.fieldType),
      options: field.options || [],
    });
  }

  return columns;
}

export async function buildRecordImportWorkbook(tenantId = DEFAULT_TENANT_ID) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Record Import Template';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Records', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  const lookupSheet = workbook.addWorksheet('Lookup Values');
  lookupSheet.state = 'veryHidden';
  const columns = recordImportColumns(tenantId);
  sheet.addRow(columns.map((column) => column.header));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: 'middle', wrapText: true };
  sheet.columns = columns.map((column) => ({
    key: column.header,
    width: Math.max(18, Math.min(36, column.header.length + 4)),
  }));

  const lookupRanges = new Map();
  columns.forEach((column, index) => {
    const values = [...new Set((column.options || []).map(String).filter(Boolean))];
    if (!values.length) return;
    const lookupColumnNumber = lookupRanges.size + 1;
    lookupSheet.getCell(1, lookupColumnNumber).value = column.header;
    values.forEach((value, rowIndex) => {
      lookupSheet.getCell(rowIndex + 2, lookupColumnNumber).value = value;
    });
    lookupSheet.getColumn(lookupColumnNumber).width = Math.max(
      18,
      Math.min(60, values.reduce((max, value) => Math.max(max, value.length), column.header.length) + 2)
    );
    const letter = excelColumnLetter(lookupColumnNumber);
    lookupRanges.set(index + 1, `'Lookup Values'!$${letter}$2:$${letter}$${values.length + 1}`);
  });

  for (let rowNumber = 2; rowNumber <= 1001; rowNumber += 1) {
    columns.forEach((column, index) => {
      const cell = sheet.getCell(rowNumber, index + 1);
      if (column.type === 'date') {
        cell.numFmt = 'yyyy-mm-dd';
        cell.dataValidation = {
          type: 'date',
          operator: 'greaterThanOrEqual',
          allowBlank: !column.required,
          formulae: [new Date(1900, 0, 1)],
          showErrorMessage: true,
          errorTitle: 'Invalid date',
          error: 'Enter a date in yyyy-mm-dd format.',
        };
      } else if (column.type === 'number' || column.type === 'currency' || column.type === 'percent') {
        cell.dataValidation = {
          type: 'decimal',
          operator: 'greaterThanOrEqual',
          allowBlank: !column.required,
          formulae: [0],
          showErrorMessage: true,
          errorTitle: 'Invalid number',
          error: 'Enter a non-negative number.',
        };
      } else if (lookupRanges.has(index + 1)) {
        cell.dataValidation = {
          type: 'list',
          allowBlank: !column.required,
          formulae: [lookupRanges.get(index + 1)],
          showErrorMessage: true,
          errorTitle: 'Invalid value',
          error: 'Choose a value from the dropdown list.',
        };
      }
    });
  }

  const instructions = workbook.addWorksheet('Instructions');
  instructions.addRows([
    ['How to use this template'],
    ['Fill rows in the Records sheet only.'],
    ['Use dropdowns where available; uploaded files are validated again by the server.'],
    ['For multi-value fields, use comma-separated values. Each value must match the lookup list exactly.'],
    ['Do not rename or remove the header row.'],
  ]);
  instructions.getColumn(1).width = 100;
  instructions.getRow(1).font = { bold: true };
  return workbook.xlsx.writeBuffer();
}

export function formatImportDateValue(value) {
  if (value === undefined || value === null || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const epoch = Date.UTC(1899, 11, 30);
    return new Date(epoch + value * 86400000).toISOString().slice(0, 10);
  }
  return String(value).trim();
}

export function excelColumnLetter(columnNumber) {
  let n = Number(columnNumber);
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function importCellValue(cell) {
  const value = cell?.value;
  if (value === undefined || value === null) return '';
  if (value instanceof Date) return formatImportDateValue(value);
  if (typeof value !== 'object') return String(value).trim();
  if (value.text) return String(value.text).trim();
  if (value.result !== undefined && value.result !== null) return String(value.result).trim();
  if (Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text || '').join('').trim();
  }
  return cell.text ? String(cell.text).trim() : '';
}

export async function rowsFromImportWorkbook(buffer, tenantId = DEFAULT_TENANT_ID) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('Records') || workbook.worksheets[0];
  if (!sheet) return [];
  const dateHeaders = new Set(
    recordImportColumns(tenantId)
      .filter((column) => column.type === 'date')
      .map((column) => column.header)
  );
  const headerRow = sheet.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const header = importCellValue(cell);
    if (header) headers[colNumber] = header;
  });
  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const item = {};
    let hasValue = false;
    headers.forEach((header, colNumber) => {
      if (!header) return;
      const rawValue = row.getCell(colNumber).value;
      let value =
        rawValue instanceof Date || (dateHeaders.has(header) && typeof rawValue === 'number')
          ? formatImportDateValue(rawValue)
          : importCellValue(row.getCell(colNumber));
      if (value !== '') hasValue = true;
      item[header] = value;
    });
    if (hasValue) rows.push(item);
  });
  return rows;
}

export function validateImportRowLookups(row, tenantId = DEFAULT_TENANT_ID) {
  for (const field of activeSystemRecordFields(tenantId)) {
    if (!isSchemaChoiceFieldType(field.fieldType)) continue;
    const header = recordFieldDbColumn(field.key);
    const multi = isSchemaMultiChoiceFieldType(field.fieldType);
    const raw =
      row[header] ??
      row[field.key] ??
      (field.key === 'dealStage' || header === 'deal_stage'
        ? defaultDealStage(tenantId)
        : undefined);
    validateImportLookupValue(
      header,
      raw,
      recordSchemaFieldOptions(tenantId, field.key),
      multi
    );
  }
  const customFields = getRecordSchemaDefinitions(tenantId).filter(
    (field) => field.source === 'custom' && field.status !== 'INACTIVE'
  );
  for (const field of customFields) {
    if (!isSchemaChoiceFieldType(field.fieldType)) continue;
    const header = `custom.${field.key}`;
    const multi = isSchemaMultiChoiceFieldType(field.fieldType);
    validateImportLookupValue(header, row[header], field.options || [], multi);
  }
}

export function splitImportList(value) {
  return String(value || '')
    .split(/[;,|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function importOwnerIds(row, tenantId) {
  const explicitIds = splitImportList(row.owner_ids || row.ownerIds);
  if (explicitIds.length) return explicitIds;
  const emails = splitImportList(row.owner_emails || row.ownerEmails).map((email) =>
    email.toLowerCase()
  );
  if (!emails.length) return [];
  const users = db
    .prepare(
      `SELECT u.id, lower(u.email) AS email
       FROM users u
       JOIN tenant_memberships tm ON tm.user_id = u.id
       WHERE tm.tenant_id = ? AND tm.status = 'ACTIVE' AND u.status = 'ACTIVE'`
    )
    .all(tenantId);
  const byEmail = new Map(users.map((user) => [user.email, user.id]));
  return emails.map((email) => byEmail.get(email)).filter(Boolean);
}

export function parseImportCustomValue(raw, field) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (['number', 'currency', 'percent'].includes(field.fieldType)) return Number(raw);
  if (field.fieldType === 'boolean') {
    const value = String(raw).trim().toLowerCase();
    return ['1', 'true', 'yes', 'y'].includes(value);
  }
  if (field.fieldType === 'multi_select' || field.fieldType === 'lookup_multi_select') return splitImportList(raw);
  return String(raw).trim();
}

export function recordImportRowToPayload(rawRow, tenantId = DEFAULT_TENANT_ID) {
  if (!rawRow || typeof rawRow !== 'object') throw new Error('row must be an object');
  const row = {};
  for (const [key, value] of Object.entries(rawRow)) {
    row[String(key).trim()] = typeof value === 'string' ? value.trim() : value;
  }
  validateImportRowLookups(row, tenantId);
  const customFields = {};
  for (const field of getTenantFieldDefinitions(tenantId)) {
    const raw = row[`custom.${field.key}`] ?? row[field.key];
    const parsed = parseImportCustomValue(raw, field);
    if (parsed !== undefined) customFields[field.key] = parsed;
  }
  return {
    prospect: row.prospect,
    opportunityDescription: row.opportunity_description || row.opportunityDescription || '',
    ownerIds: importOwnerIds(row, tenantId),
    deliverables: splitImportList(row.deliverables),
    dueDate: row.due_date || row.dueDate,
    status: row.status,
    prospectType: row.prospect_type || row.prospectType,
    engagementType: row.engagement_type || row.engagementType,
    dealStage: row.deal_stage || row.dealStage || defaultDealStage(tenantId),
    value: row.value === '' || row.value === undefined ? 0 : Number(row.value),
    currency: row.currency || 'USD',
    winOrLoss: row.win_or_loss || row.winOrLoss || 'Open',
    notes: row.notes || '',
    firstPresalesCall: row.first_presales_call || row.firstPresalesCall || null,
    closedDate: row.closed_date || row.closedDate || null,
    customFields,
  };
}

export function exportRecordRows(req, analyticsApi) {
  const tenantId = tenantIdFromReq(req);
  let ownerId = req.query.ownerId ? String(req.query.ownerId) : '';
  if (req.query.mine === '1' || req.query.mine === 'true') {
    const sub = req.user?.sub ? String(req.user.sub) : '';
    if (sub) ownerId = sub;
  }
  const { where, params } = analyticsApi.buildRecordFilterWhere(tenantId, {
    archived: req.query.archived || 'exclude',
    draft: req.query.draft,
    status: req.query.status,
    dealStage: req.query.dealStage,
    winOrLoss: req.query.winOrLoss,
    prospectType: req.query.prospectType,
    engagementType: req.query.engagementType,
    dueDateFrom: req.query.fromDueDate,
    dueDateTo: req.query.toDueDate,
    ownerId,
    q: req.query.q,
    customField: req.query.customField,
    customValue: req.query.customValue,
  });
  const sql = `SELECT * FROM opportunities ${where} ORDER BY due_date ASC`;
  return db.prepare(sql).all(...params);
}

export function recordExportRows(tenantId, rows) {
  const headers = recordImportHeaders(tenantId);
  const schemaFields = getTenantFieldDefinitions(tenantId);
  const items = rows.map((r) => {
    const o = mapOpportunityRow(r);
    const byHeader = {
      prospect: o.prospect,
      opportunity_description: o.opportunityDescription,
      owner_emails: (o.owners || []).map((x) => x.email).filter(Boolean).join('; '),
      deliverables: Array.isArray(o.deliverables) ? o.deliverables.join('; ') : '',
      due_date: o.dueDate,
      status: o.status,
      prospect_type: o.prospectType,
      engagement_type: o.engagementType,
      deal_stage: o.dealStage,
      value: o.value ?? '',
      currency: o.currency || 'USD',
      win_or_loss: o.winOrLoss,
      notes: o.notes || '',
      first_presales_call: o.firstPresalesCall || '',
      closed_date: o.closedDate || '',
    };
    for (const field of schemaFields) {
      byHeader[`custom.${field.key}`] = formatExportCell(o.customFields?.[field.key]);
    }
    return byHeader;
  });
  return { headers, items };
}

export { csvEscape, formatExportCell };

