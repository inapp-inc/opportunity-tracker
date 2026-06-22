import { randomUUID } from 'crypto';
import { db, migrate } from './db.js';
import { hashPassword } from './auth-utils.js';

const TENANT_ID = 'default-tenant';

function nowIso() {
  return new Date().toISOString();
}

function dateOffset(days) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

migrate();

const existingSarah = db
  .prepare(`SELECT id FROM users WHERE lower(email) = ?`)
  .get('sarah.mitchell@inapp.com');

if (existingSarah) {
  console.log('Seed data already present, skipping.');
  process.exit(0);
}

const now = nowIso();
const passwordHash = hashPassword('password123');

db.prepare(
  `INSERT OR IGNORE INTO tenants (id, name, slug, status, created_at, updated_at)
   VALUES (?, ?, ?, 'ACTIVE', ?, ?)`
).run(TENANT_ID, 'Default Team', 'default', now, now);

const sarahId = randomUUID();
const rajId = randomUUID();
const emmaId = randomUUID();
const jamesId = randomUUID();
const priyaId = randomUUID();

const insertUser = db.prepare(
  `INSERT INTO users (
    id, tenant_id, email, password_hash, name, role, platform_role, status, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, 'MEMBER', 'NONE', 'ACTIVE', ?, ?)`
);

const teamMembers = [
  { id: sarahId, name: 'Sarah Mitchell', email: 'sarah.mitchell@inapp.com' },
  { id: rajId, name: 'Raj Patel', email: 'raj.patel@inapp.com' },
  { id: emmaId, name: 'Emma Chen', email: 'emma.chen@inapp.com' },
  { id: jamesId, name: "James O'Brien", email: 'james.obrien@inapp.com' },
  { id: priyaId, name: 'Priya Nair', email: 'priya.nair@inapp.com' },
];

for (const member of teamMembers) {
  insertUser.run(member.id, TENANT_ID, member.email, passwordHash, member.name, now, now);
}

const insertMembership = db.prepare(
  `INSERT OR IGNORE INTO tenant_memberships (
    id, user_id, tenant_id, role, permissions_json, status, created_at, updated_at
  ) VALUES (?, ?, ?, 'MEMBER', '[]', 'ACTIVE', ?, ?)`
);

for (const member of teamMembers) {
  insertMembership.run(`${member.id}:${TENANT_ID}`, member.id, TENANT_ID, now, now);
}

const insertOpportunity = db.prepare(
  `INSERT INTO opportunities (
    id, tenant_id, prospect, opportunity_description, owner_json, deliverables, due_date, status, notes,
    win_or_loss, first_presales_call, closed_date, prospect_type, engagement_type,
    value, currency, deal_stage, custom_data_json, is_draft, version, archived, created_at, updated_at
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?, 0, 1, 0, ?, ?
  )`
);

const insertDeliverable = db.prepare(
  `INSERT INTO opportunity_deliverables (
    id, opportunity_id, tenant_id, deliverable_type, due_date, start_date, closed_date,
    notes, sort_order, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

const insertRecordOwner = db.prepare(
  `INSERT OR IGNORE INTO record_owners (record_id, tenant_id, user_id, created_at)
   VALUES (?, ?, ?, ?)`
);

function seedOpportunity({
  prospect,
  description,
  prospectType,
  engagementType,
  dealStage,
  status,
  winOrLoss,
  value,
  currency,
  firstPresalesCallDaysAgo,
  closedDate = null,
  ownerIds,
  deliverables,
}) {
  const oppId = randomUUID();
  const deliverableTypes = deliverables.map((d) => d.type);
  const deliverablesText = deliverableTypes.join(', ');
  const firstDueDate = deliverables[0].dueDate;

  insertOpportunity.run(
    oppId,
    TENANT_ID,
    prospect,
    description,
    JSON.stringify(ownerIds),
    deliverablesText,
    firstDueDate,
    status,
    '',
    winOrLoss,
    dateOffset(-firstPresalesCallDaysAgo),
    closedDate,
    prospectType,
    engagementType,
    value,
    currency,
    dealStage,
    '{}',
    now,
    now
  );

  for (const ownerId of ownerIds) {
    insertRecordOwner.run(oppId, TENANT_ID, ownerId, now);
  }

  deliverables.forEach((deliverable, index) => {
    insertDeliverable.run(
      randomUUID(),
      oppId,
      TENANT_ID,
      deliverable.type,
      deliverable.dueDate,
      deliverable.startDate ?? null,
      deliverable.closedDate ?? null,
      deliverable.notes ?? '',
      index,
      now,
      now
    );
  });

  return { oppId, deliverableCount: deliverables.length };
}

const opportunitySeeds = [
  {
    prospect: 'Acme Corporation',
    description:
      'Enterprise cloud migration from on-prem infrastructure to AWS. Includes data warehousing and CI/CD pipeline setup.',
    prospectType: 'Enterprise',
    engagementType: 'POC',
    dealStage: 'Solutioning',
    status: 'In Progress',
    winOrLoss: 'Open',
    value: 180000,
    currency: 'USD',
    firstPresalesCallDaysAgo: 60,
    ownerIds: [sarahId, rajId],
    deliverables: [
      {
        type: 'POC',
        dueDate: dateOffset(30),
        startDate: dateOffset(-10),
        notes: 'Focus on data migration performance benchmarks',
      },
      {
        type: 'Technical Architecture',
        dueDate: dateOffset(60),
      },
    ],
  },
  {
    prospect: 'TechNova Inc',
    description:
      'Evaluation of AI-powered customer support automation platform with NLP capabilities.',
    prospectType: 'Mid-Market',
    engagementType: 'Demo',
    dealStage: 'Qualification',
    status: 'Not Started',
    winOrLoss: 'Open',
    value: 75000,
    currency: 'USD',
    firstPresalesCallDaysAgo: 30,
    ownerIds: [emmaId],
    deliverables: [
      {
        type: 'Demo',
        dueDate: dateOffset(14),
        startDate: dateOffset(5),
      },
    ],
  },
  {
    prospect: 'GlobalBank Ltd',
    description:
      'Security posture assessment and zero-trust architecture proposal for core banking systems.',
    prospectType: 'Enterprise',
    engagementType: 'RFP',
    dealStage: 'Proposal',
    status: 'In Progress',
    winOrLoss: 'Open',
    value: 320000,
    currency: 'USD',
    firstPresalesCallDaysAgo: 45,
    ownerIds: [rajId, jamesId],
    deliverables: [
      {
        type: 'RFP/RFI Response',
        dueDate: dateOffset(7),
        startDate: dateOffset(-5),
        notes: 'Must address SOC2 compliance requirements',
      },
      {
        type: 'Proposal',
        dueDate: dateOffset(30),
      },
    ],
  },
  {
    prospect: 'RetailCo',
    description:
      'Omnichannel e-commerce platform POC integrating POS, inventory, and customer loyalty systems.',
    prospectType: 'Mid-Market',
    engagementType: 'POC',
    dealStage: 'Discovery',
    status: 'Not Started',
    winOrLoss: 'Open',
    value: 95000,
    currency: 'USD',
    firstPresalesCallDaysAgo: 15,
    ownerIds: [priyaId],
    deliverables: [
      {
        type: 'POC',
        dueDate: dateOffset(45),
        startDate: dateOffset(10),
      },
    ],
  },
  {
    prospect: 'HealthFirst Systems',
    description:
      'Patient portal MVP with appointment scheduling, telemedicine, and EHR integration.',
    prospectType: 'Enterprise',
    engagementType: 'POC',
    dealStage: 'Negotiation',
    status: 'In Progress',
    winOrLoss: 'Open',
    value: 250000,
    currency: 'USD',
    firstPresalesCallDaysAgo: 90,
    ownerIds: [sarahId, emmaId],
    deliverables: [
      {
        type: 'POC',
        dueDate: dateOffset(20),
        startDate: dateOffset(-30),
        notes: 'HIPAA compliance is non-negotiable',
      },
      {
        type: 'MVP',
        dueDate: dateOffset(90),
        notes: 'Phase 2 pending POC sign-off',
      },
    ],
  },
  {
    prospect: 'StartupX',
    description:
      'Rapid MVP build for B2B SaaS product targeting HR tech market. Includes API integrations.',
    prospectType: 'SMB',
    engagementType: 'Demo',
    dealStage: 'Closed',
    status: 'Completed',
    winOrLoss: 'Win',
    value: 45000,
    currency: 'USD',
    firstPresalesCallDaysAgo: 120,
    closedDate: dateOffset(-25),
    ownerIds: [jamesId],
    deliverables: [
      {
        type: 'MVP',
        dueDate: dateOffset(-30),
        startDate: dateOffset(-60),
        closedDate: dateOffset(-25),
        notes: 'Delivered ahead of schedule',
      },
    ],
  },
  {
    prospect: 'MegaCorp Industries',
    description:
      'Digital transformation roadmap and technical architecture review across 6 business units.',
    prospectType: 'Enterprise',
    engagementType: 'RFP',
    dealStage: 'Qualification',
    status: 'In Progress',
    winOrLoss: 'Open',
    value: 410000,
    currency: 'USD',
    firstPresalesCallDaysAgo: 20,
    ownerIds: [rajId, priyaId],
    deliverables: [
      {
        type: 'RFP/RFI Response',
        dueDate: dateOffset(5),
        startDate: dateOffset(-10),
      },
      {
        type: 'Technical Architecture',
        dueDate: dateOffset(35),
      },
      {
        type: 'Proposal',
        dueDate: dateOffset(50),
      },
    ],
  },
  {
    prospect: 'DataDriven Analytics',
    description:
      'Real-time analytics dashboard POC using existing data lake with Tableau and custom API layer.',
    prospectType: 'Mid-Market',
    engagementType: 'POC',
    dealStage: 'Solutioning',
    status: 'In Progress',
    winOrLoss: 'Open',
    value: 88000,
    currency: 'USD',
    firstPresalesCallDaysAgo: 35,
    ownerIds: [emmaId, sarahId],
    deliverables: [
      {
        type: 'POC',
        dueDate: dateOffset(21),
        startDate: dateOffset(-7),
        notes: 'Stakeholder demo scheduled for end of sprint',
      },
    ],
  },
];

let opportunityCount = 0;
let deliverableCount = 0;

for (const seed of opportunitySeeds) {
  const result = seedOpportunity(seed);
  opportunityCount += 1;
  deliverableCount += result.deliverableCount;
}

console.log(
  `Seed complete: ${opportunityCount} opportunities and ${deliverableCount} deliverables inserted.`
);
process.exit(0);
