import { randomUUID } from 'crypto';
import { db } from '../db.js';
import { DEFAULT_TENANT_ID } from '../constants.js';
import { nowIso, startOfDay, dayDiff } from '../utils/time.js';
import { getSettingsPayload } from './configService.js';

export function getReminderOffsetsForEvaluator(tenantId = DEFAULT_TENANT_ID) {
  try {
    const { reminderOffsets } = getSettingsPayload(tenantId);
    return [...new Set(reminderOffsets.map(Number).filter((n) => !Number.isNaN(n)))].sort(
      (a, b) => b - a
    );
  } catch {
    return [7, 3, 1, 0];
  }
}

export function reminderMessage(daysRemaining, prospect, dueDate) {
  if (daysRemaining === 0) return `${prospect} is due today (${dueDate})`;
  if (daysRemaining === 1) return `${prospect} is due tomorrow (${dueDate})`;
  return `${prospect} is due in ${daysRemaining} days (${dueDate})`;
}

export function mapNotificationRow(r) {
  const uiType =
    r.type === 'OVERDUE'
      ? 'overdue'
      : r.type === 'REMINDER_DAY'
        ? 'reminder'
        : 'reminder';
  return {
    id: r.id,
    dbType: r.type,
    type: uiType,
    title:
      r.type === 'OVERDUE' ? 'Opportunity overdue' : 'Due date reminder',
    message: r.message || '',
    opportunityId: r.opportunity_id,
    opportunityName: r.prospect || '',
    timestamp: r.created_at.replace('T', ' ').slice(0, 16),
    isRead: !!r.is_read,
    actionRequired: r.type === 'OVERDUE',
  };
}

export function runNotificationEvaluator() {
  try {
    _runNotificationEvaluator();
  } catch (err) {
    // Don't crash the process — DB may be temporarily unavailable
    console.warn('[notifications] evaluator error:', err.message);
  }
}

function _runNotificationEvaluator() {
  const today = new Date();
  const future = new Date(startOfDay(today) + 30 * 86400000)
    .toISOString()
    .slice(0, 10);
  const opps = db
    .prepare(
      `SELECT id, tenant_id, prospect, due_date, status, archived, is_draft
       FROM opportunities
       WHERE COALESCE(archived,0) = 0
         AND COALESCE(is_draft,0) = 0
         AND status <> 'Completed'
         AND due_date IS NOT NULL
         AND due_date <= ?`
    )
    .all(future);
  const offsetsByTenant = new Map();

  const insert = db.prepare(
    `INSERT OR IGNORE INTO notifications (
       id, tenant_id, opportunity_id, type, channel, state, trigger_at, idempotency_key, message, is_read, created_at
     ) VALUES (
       @id, @tenant_id, @opportunity_id, @type, @channel, @state, @trigger_at, @idempotency_key, @message, 0, @created_at
     )`
  );

  for (const o of opps) {
    let due;
    try {
      due = new Date(o.due_date + 'T12:00:00');
    } catch {
      continue;
    }
    const dd = Math.floor(dayDiff(due, today));
    const tenantId = o.tenant_id || DEFAULT_TENANT_ID;
    if (!offsetsByTenant.has(tenantId)) {
      offsetsByTenant.set(tenantId, getReminderOffsetsForEvaluator(tenantId));
    }
    const offsets = offsetsByTenant.get(tenantId);

    if (dd < 0) {
      insert.run({
        id: randomUUID(),
        tenant_id: tenantId,
        opportunity_id: o.id,
        type: 'OVERDUE',
        channel: 'IN_APP',
        state: 'SENT',
        trigger_at: nowIso(),
        idempotency_key: `${tenantId}|overdue|${o.id}|${o.due_date}`,
        message: `${o.prospect} is overdue (due ${o.due_date})`,
        created_at: nowIso(),
      });
      continue;
    }

    for (const off of offsets) {
      if (dd !== off) continue;
      const type = off === 7 ? 'REMINDER_7' : 'REMINDER_DAY';
      insert.run({
        id: randomUUID(),
        tenant_id: tenantId,
        opportunity_id: o.id,
        type,
        channel: 'IN_APP',
        state: 'SENT',
        trigger_at: nowIso(),
        idempotency_key: `${tenantId}|r${off}|${o.id}|${o.due_date}`,
        message: reminderMessage(off, o.prospect, o.due_date),
        created_at: nowIso(),
      });
    }
  }
}

