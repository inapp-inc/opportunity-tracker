const CORE_ANALYTICS_DIMENSIONS = [
  { key: 'status', label: 'Status', column: 'status' },
  { key: 'dealStage', label: 'Deal stage', column: 'deal_stage' },
  { key: 'winOrLoss', label: 'Win/Loss', column: 'win_or_loss' },
  { key: 'prospectType', label: 'Prospect type', column: 'prospect_type' },
  { key: 'engagementType', label: 'Engagement type', column: 'engagement_type' },
  { key: 'currency', label: 'Currency', column: 'currency' },
  { key: 'dueMonth', label: 'Due month', expr: "strftime('%Y-%m', due_date)" },
  { key: 'owner', label: 'Owner', virtual: true },
  { key: 'ownerId', label: 'Owner', virtual: true },
];

const ALLOWED_MEASURES = new Set(['count', 'sumValue', 'avgValue']);

function initAnalytics(deps) {
  const {
    db,
    mapOpportunityRow,
    ownerDisplayNames,
    getTenantFieldDefinitions,
    getDefaultDealStage,
    DEFAULT_TENANT_ID,
  } = deps;

  function analyticsDimensionsForTenant(tenantId = DEFAULT_TENANT_ID) {
    const custom = getTenantFieldDefinitions(tenantId)
      .filter((field) => field.source !== 'system')
      .map((field) => ({
        key: `custom:${field.key}`,
        label: field.label,
        customKey: field.key,
        virtual: true,
      }));
    return [...CORE_ANALYTICS_DIMENSIONS, ...custom];
  }

  function parseAnalyticsFilters(raw = {}) {
    const merged = raw && typeof raw === 'object' ? raw : {};
    return {
      archived: String(merged.archived || 'exclude'),
      draft: String(merged.draft || 'exclude'),
      status: String(merged.status || merged.statusFilter || '').trim(),
      dealStage: String(merged.dealStage || '').trim(),
      winOrLoss: String(merged.winOrLoss || '').trim(),
      prospectType: String(merged.prospectType || '').trim(),
      engagementType: String(merged.engagementType || '').trim(),
      dueDateFrom: String(
        merged.dueDateFrom || merged.fromDueDate || merged.fromDate || ''
      ).trim(),
      dueDateTo: String(merged.dueDateTo || merged.toDueDate || merged.toDate || '').trim(),
      ownerId: String(merged.ownerId || merged.owner || '').trim(),
      q: String(merged.q || '').trim().toLowerCase(),
      customField: String(merged.customField || merged.custom?.field || '').trim(),
      customValue: String(merged.customValue || merged.custom?.value || '').trim(),
    };
  }

  function parseAnalyticsFiltersFromQuery(query = {}) {
    return parseAnalyticsFilters(query);
  }

  function buildRecordFilterWhere(tenantId, filters) {
    const f = parseAnalyticsFilters(filters);
    let where = 'WHERE tenant_id = ?';
    const params = [tenantId];

    if (f.archived === 'exclude') {
      where += ' AND COALESCE(archived,0) = 0';
    } else if (f.archived === 'only') {
      where += ' AND COALESCE(archived,0) = 1';
    }

    // Draft filtering: exclude by default so dashboards/notifications stay clean.
    // Use draft=include to show both drafts and published records, or draft=only for drafts.
    if (f.draft === 'exclude' || !f.draft) {
      where += ' AND COALESCE(is_draft,0) = 0';
    } else if (f.draft === 'only') {
      where += ' AND COALESCE(is_draft,0) = 1';
    }

    if (f.status) {
      where += ' AND status = ?';
      params.push(f.status);
    }
    if (f.dealStage) {
      const defaultStage = getDefaultDealStage
        ? String(getDefaultDealStage(tenantId) || '').trim()
        : '';
      where += ` AND COALESCE(NULLIF(TRIM(deal_stage), ''), ?) = ?`;
      params.push(defaultStage, f.dealStage);
    }
    if (f.winOrLoss) {
      where += ' AND win_or_loss = ?';
      params.push(f.winOrLoss);
    }
    if (f.prospectType) {
      where += ' AND prospect_type = ?';
      params.push(f.prospectType);
    }
    if (f.engagementType) {
      where += ' AND engagement_type = ?';
      params.push(f.engagementType);
    }
    if (f.dueDateFrom) {
      where += ' AND due_date >= ?';
      params.push(f.dueDateFrom);
    }
    if (f.dueDateTo) {
      where += ' AND due_date <= ?';
      params.push(f.dueDateTo);
    }
    if (f.ownerId) {
      where += ` AND EXISTS (
        SELECT 1 FROM record_owners ro
        WHERE ro.record_id = opportunities.id
          AND ro.tenant_id = opportunities.tenant_id
          AND ro.user_id = ?
      )`;
      params.push(f.ownerId);
    }
    if (f.q) {
      where += ' AND (lower(prospect) LIKE ? OR lower(opportunity_description) LIKE ?)';
      params.push(`%${f.q}%`, `%${f.q}%`);
    }
    if (f.customField && f.customValue) {
      const key = String(f.customField).replace(/[^a-z0-9_]/gi, '');
      if (key) {
        const jsonPath = `$.${key}`;
        where += ` AND (
          json_extract(custom_data_json, ?) = ?
          OR EXISTS (
            SELECT 1 FROM json_each(json_extract(custom_data_json, ?))
            WHERE json_each.value = ?
          )
        )`;
        params.push(jsonPath, f.customValue, jsonPath, f.customValue);
      }
    }

    return { where, params, filters: f };
  }

  function readCustomFieldValue(customDataJson, customKey) {
    try {
      const data = JSON.parse(customDataJson || '{}');
      const raw = data[customKey];
      if (Array.isArray(raw)) return raw.map(String);
      if (raw === undefined || raw === null || raw === '') return ['Unspecified'];
      return [String(raw)];
    } catch {
      return ['Unspecified'];
    }
  }

  function dimensionValuesForRow(row, dimensionKey, tenantId) {
    const dim = analyticsDimensionsForTenant(tenantId).find((item) => item.key === dimensionKey);
    if (!dim) return ['Unspecified'];

    if (dimensionKey === 'owner') {
      const names = ownerDisplayNames(row.owner_json, tenantId);
      return names.length ? names : ['Unassigned'];
    }

    if (dimensionKey === 'ownerId') {
      let ids = [];
      try {
        ids = JSON.parse(row.owner_json || '[]');
      } catch {
        ids = [];
      }
      if (!Array.isArray(ids)) ids = [ids].filter(Boolean);
      const normalized = ids.map(String).filter(Boolean);
      return normalized.length ? normalized : [''];
    }

    if (dimensionKey.startsWith('custom:')) {
      return readCustomFieldValue(row.custom_data_json, dim.customKey);
    }

    if (dim.expr) {
      const due = row.due_date ? String(row.due_date).slice(0, 7) : '';
      return [due || 'Unspecified'];
    }

    const raw = row[dim.column];
    return [raw === undefined || raw === null || raw === '' ? 'Unspecified' : String(raw)];
  }

  function aggregateRowsInMemory(rows, tenantId, groupBy, measures, limit) {
    const buckets = new Map();

    for (const row of rows) {
      const value = Number(row.value || 0);
      const dimValuesByKey = {};
      for (const key of groupBy) {
        dimValuesByKey[key] = dimensionValuesForRow(row, key, tenantId);
      }

      const combos = [{}];
      for (const key of groupBy) {
        const next = [];
        for (const combo of combos) {
          for (const valueLabel of dimValuesByKey[key]) {
            next.push({ ...combo, [key]: valueLabel });
          }
        }
        combos.length = 0;
        combos.push(...next);
      }

      for (const combo of combos) {
        const bucketKey = groupBy.map((key) => `${key}=${combo[key]}`).join('|');
        const bucket = buckets.get(bucketKey) || {
          ...combo,
          count: 0,
          sumValue: 0,
        };
        bucket.count += 1;
        bucket.sumValue += dimensionKeyIncludesOwner(groupBy)
          ? value / Math.max(dimValuesByKey.owner?.length || 1, 1)
          : value;
        buckets.set(bucketKey, bucket);
      }
    }

    const result = [...buckets.values()]
      .map((row) => ({
        ...row,
        avgValue: row.count ? row.sumValue / row.count : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, Math.min(limit, 500));

    return result;
  }

  function dimensionKeyIncludesOwner(groupBy) {
    return groupBy.includes('owner') || groupBy.includes('ownerId');
  }

  function usesVirtualDimensions(tenantId, groupBy) {
    const dimMap = new Map(analyticsDimensionsForTenant(tenantId).map((d) => [d.key, d]));
    return groupBy.some((key) => {
      const dim = dimMap.get(key);
      if (!dim) return false;
      if (dim.virtual) return true;
      return key === 'owner' || key === 'ownerId' || key.startsWith('custom:');
    });
  }

  function computeTotals(rows, measures) {
    const totals = {};
    if (measures.includes('count')) {
      totals.count = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
    }
    if (measures.includes('sumValue')) {
      totals.sumValue = rows.reduce((sum, row) => sum + Number(row.sumValue || 0), 0);
    }
    if (measures.includes('avgValue')) {
      const count = totals.count || rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
      const sumValue =
        totals.sumValue || rows.reduce((sum, row) => sum + Number(row.sumValue || 0), 0);
      totals.avgValue = count ? sumValue / count : 0;
    }
    return totals;
  }

  function runAnalyticsQuery(tenantId, body = {}) {
    const filters = parseAnalyticsFilters(body.filters || {});
    const dims = analyticsDimensionsForTenant(tenantId);
    const dimMap = new Map(dims.map((item) => [item.key, item]));
    const groupBy = (Array.isArray(body.groupBy) ? body.groupBy : [body.groupBy]).filter(Boolean);
    if (!groupBy.length) {
      throw new Error('groupBy required');
    }
    for (const key of groupBy) {
      if (!dimMap.has(key)) throw new Error(`invalid dimension: ${key}`);
    }

    const measures = (Array.isArray(body.measures) ? body.measures : ['count']).filter((item) =>
      ALLOWED_MEASURES.has(item)
    );
    if (!measures.length) measures.push('count');
    const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 500);

    const { where, params } = buildRecordFilterWhere(tenantId, filters);

    if (usesVirtualDimensions(tenantId, groupBy)) {
      const rows = db.prepare(`SELECT * FROM opportunities ${where}`).all(...params);
      const aggregated = aggregateRowsInMemory(rows, tenantId, groupBy, measures, limit);
      return {
        rows: aggregated.map((row) => pickMeasures(row, measures, groupBy)),
        totals: computeTotals(aggregated, measures),
        filters,
        groupBy,
        measures,
      };
    }

    const selectParts = [];
    const groupParts = [];
    for (const key of groupBy) {
      const dim = dimMap.get(key);
      if (!dim || dim.virtual) {
        throw new Error(`dimension ${key} cannot be aggregated in SQL`);
      }
      if (dim.expr) {
        selectParts.push(`${dim.expr} AS "${key}"`);
        groupParts.push(dim.expr);
      } else if (dim.column) {
        selectParts.push(`${dim.column} AS "${key}"`);
        groupParts.push(dim.column);
      } else {
        throw new Error(`dimension ${key} has no SQL expression`);
      }
    }

    // Always include an internal COUNT(*) so ORDER BY remains valid even
    // when the caller doesn't request `count` as a returned measure.
    const measureSql = ['COUNT(*) AS __count'];
    if (measures.includes('count')) measureSql.push('COUNT(*) AS count');
    if (measures.includes('sumValue')) measureSql.push('COALESCE(SUM(value),0) AS sumValue');
    if (measures.includes('avgValue')) measureSql.push('COALESCE(AVG(value),0) AS avgValue');

    const sql = `SELECT ${selectParts.join(', ')}, ${measureSql.join(', ')}
      FROM opportunities ${where}
      GROUP BY ${groupParts.join(', ')}
      ORDER BY __count DESC
      LIMIT ?`;
    const rows = db.prepare(sql).all(...params, limit).map((row) => {
      const next = { ...row };
      for (const key of groupBy) {
        if (next[key] === null || next[key] === '') next[key] = 'Unspecified';
      }
      const picked = pickMeasures(next, measures, groupBy);
      // Ensure we never leak the internal ordering column.
      delete picked.__count;
      return picked;
    });

    return {
      rows,
      totals: computeTotals(rows, measures),
      filters,
      groupBy,
      measures,
    };
  }

  function pickMeasures(row, measures, groupBy) {
    const next = {};
    for (const key of groupBy) next[key] = row[key];
    for (const measure of measures) next[measure] = row[measure];
    return next;
  }

  function buildPipelineSummary(tenantId, query = {}) {
    const filters = parseAnalyticsFiltersFromQuery(query);
    const { where, params } = buildRecordFilterWhere(tenantId, filters);

    const statusRows = db
      .prepare(
        `SELECT status, COUNT(*) AS count, COALESCE(SUM(value),0) AS totalValue
         FROM opportunities ${where}
         GROUP BY status`
      )
      .all(...params);

    const allForOwners = db
      .prepare(`SELECT owner_json AS oj, value FROM opportunities ${where}`)
      .all(...params);

    const ownerMap = new Map();
    const ownerCounts = new Map();
    for (const row of allForOwners) {
      let names = ownerDisplayNames(row.oj, tenantId);
      if (!names.length) names = ['Unassigned'];
      const share = Number(row.value || 0) / names.length;
      for (const name of names) {
        ownerCounts.set(name, (ownerCounts.get(name) || 0) + 1);
        ownerMap.set(name, (ownerMap.get(name) || 0) + share);
      }
    }

    const countsByOwner = [...ownerCounts.entries()].map(([ownerId, count]) => ({
      ownerId,
      count,
      totalValue: Math.round((ownerMap.get(ownerId) || 0) * 100) / 100,
    }));

    return {
      totalsByStatus: statusRows.map((row) => ({
        status: row.status,
        count: row.count,
        totalValue: row.totalValue,
      })),
      countsByOwner,
      filters,
    };
  }

  return {
    analyticsDimensionsForTenant,
    parseAnalyticsFilters,
    parseAnalyticsFiltersFromQuery,
    buildRecordFilterWhere,
    runAnalyticsQuery,
    buildPipelineSummary,
  };
}

export { initAnalytics, CORE_ANALYTICS_DIMENSIONS };