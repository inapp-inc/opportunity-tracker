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

const owners = { sarahId, rajId, emmaId, jamesId, priyaId };

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

const insertRecordOwner = db.prepare(
  `INSERT OR IGNORE INTO record_owners (record_id, tenant_id, user_id, created_at)
   VALUES (?, ?, ?, ?)`
);

const records = [
  {
    prospect: 'Acme Corporation',
    deliverable: 'POC',
    description:
      'Enterprise cloud migration from on-prem to AWS including data warehousing and CI/CD setup.',
    prospectType: 'Enterprise',
    engagementType: 'POC',
    dealStage: 'Solutioning',
    status: 'In Progress',
    winOrLoss: 'Open',
    value: 150000,
    dueDate: dateOffset(30),
    firstPresalesCallDaysAgo: 60,
    notes: 'Focus on data migration benchmarks',
    ownerKeys: ['sarahId', 'rajId'],
  },
  {
    prospect: 'Acme Corporation',
    deliverable: 'Technical Architecture',
    description:
      'Enterprise cloud migration from on-prem to AWS including data warehousing and CI/CD setup.',
    prospectType: 'Enterprise',
    engagementType: 'POC',
    dealStage: 'Solutioning',
    status: 'Not Started',
    winOrLoss: 'Open',
    value: 30000,
    dueDate: dateOffset(60),
    firstPresalesCallDaysAgo: 60,
    notes: 'Phase 2 post-POC sign-off',
    ownerKeys: ['sarahId', 'rajId'],
  },
  {
    prospect: 'TechNova Inc',
    deliverable: 'Demo',
    description: 'Evaluation of AI-powered customer support automation with NLP capabilities.',
    prospectType: 'Mid-Market',
    engagementType: 'Demo',
    dealStage: 'Qualification',
    status: 'Not Started',
    winOrLoss: 'Open',
    value: 75000,
    dueDate: dateOffset(14),
    firstPresalesCallDaysAgo: 30,
    notes: '',
    ownerKeys: ['emmaId'],
  },
  {
    prospect: 'GlobalBank Ltd',
    deliverable: 'RFP/RFI Response',
    description:
      'Security posture assessment and zero-trust architecture for core banking systems.',
    prospectType: 'Enterprise',
    engagementType: 'RFP',
    dealStage: 'Proposal',
    status: 'In Progress',
    winOrLoss: 'Open',
    value: 200000,
    dueDate: dateOffset(7),
    firstPresalesCallDaysAgo: 45,
    notes: 'Must address SOC2 compliance',
    ownerKeys: ['rajId', 'jamesId'],
  },
  {
    prospect: 'GlobalBank Ltd',
    deliverable: 'Proposal',
    description:
      'Security posture assessment and zero-trust architecture for core banking systems.',
    prospectType: 'Enterprise',
    engagementType: 'RFP',
    dealStage: 'Proposal',
    status: 'Not Started',
    winOrLoss: 'Open',
    value: 120000,
    dueDate: dateOffset(30),
    firstPresalesCallDaysAgo: 45,
    notes: '',
    ownerKeys: ['rajId', 'jamesId'],
  },
  {
    prospect: 'RetailCo',
    deliverable: 'POC',
    description:
      'Omnichannel e-commerce platform integrating POS, inventory, and customer loyalty.',
    prospectType: 'Mid-Market',
    engagementType: 'POC',
    dealStage: 'Discovery',
    status: 'Not Started',
    winOrLoss: 'Open',
    value: 95000,
    dueDate: dateOffset(45),
    firstPresalesCallDaysAgo: 15,
    notes: '',
    ownerKeys: ['priyaId'],
  },
  {
    prospect: 'HealthFirst Systems',
    deliverable: 'POC',
    description:
      'Patient portal MVP with appointment scheduling, telemedicine, and EHR integration.',
    prospectType: 'Enterprise',
    engagementType: 'POC',
    dealStage: 'Negotiation',
    status: 'In Progress',
    winOrLoss: 'Open',
    value: 120000,
    dueDate: dateOffset(20),
    firstPresalesCallDaysAgo: 90,
    notes: 'HIPAA compliance non-negotiable',
    ownerKeys: ['sarahId', 'emmaId'],
  },
  {
    prospect: 'HealthFirst Systems',
    deliverable: 'MVP',
    description:
      'Patient portal MVP with appointment scheduling, telemedicine, and EHR integration.',
    prospectType: 'Enterprise',
    engagementType: 'POC',
    dealStage: 'Negotiation',
    status: 'Not Started',
    winOrLoss: 'Open',
    value: 130000,
    dueDate: dateOffset(90),
    firstPresalesCallDaysAgo: 90,
    notes: 'Phase 2 pending POC sign-off',
    ownerKeys: ['sarahId', 'emmaId'],
  },
  {
    prospect: 'StartupX',
    deliverable: 'MVP',
    description:
      'Rapid MVP build for B2B SaaS targeting HR tech market including API integrations.',
    prospectType: 'SMB',
    engagementType: 'Demo',
    dealStage: 'Closed',
    status: 'Completed',
    winOrLoss: 'Win',
    value: 45000,
    dueDate: dateOffset(-30),
    firstPresalesCallDaysAgo: 120,
    notes: 'Delivered ahead of schedule',
    ownerKeys: ['jamesId'],
  },
  {
    prospect: 'MegaCorp Industries',
    deliverable: 'RFP/RFI Response',
    description:
      'Digital transformation roadmap and technical architecture review across 6 business units.',
    prospectType: 'Enterprise',
    engagementType: 'RFP',
    dealStage: 'Qualification',
    status: 'In Progress',
    winOrLoss: 'Open',
    value: 150000,
    dueDate: dateOffset(5),
    firstPresalesCallDaysAgo: 20,
    notes: '',
    ownerKeys: ['rajId', 'priyaId'],
  },
  {
    prospect: 'MegaCorp Industries',
    deliverable: 'Technical Architecture',
    description:
      'Digital transformation roadmap and technical architecture review across 6 business units.',
    prospectType: 'Enterprise',
    engagementType: 'RFP',
    dealStage: 'Qualification',
    status: 'Not Started',
    winOrLoss: 'Open',
    value: 130000,
    dueDate: dateOffset(35),
    firstPresalesCallDaysAgo: 20,
    notes: '',
    ownerKeys: ['rajId', 'priyaId'],
  },
  {
    prospect: 'MegaCorp Industries',
    deliverable: 'Proposal',
    description:
      'Digital transformation roadmap and technical architecture review across 6 business units.',
    prospectType: 'Enterprise',
    engagementType: 'RFP',
    dealStage: 'Qualification',
    status: 'Not Started',
    winOrLoss: 'Open',
    value: 130000,
    dueDate: dateOffset(50),
    firstPresalesCallDaysAgo: 20,
    notes: '',
    ownerKeys: ['rajId', 'priyaId'],
  },
  {
    prospect: 'DataDriven Analytics',
    deliverable: 'POC',
    description:
      'Real-time analytics dashboard using existing data lake with Tableau and custom API layer.',
    prospectType: 'Mid-Market',
    engagementType: 'POC',
    dealStage: 'Solutioning',
    status: 'In Progress',
    winOrLoss: 'Open',
    value: 88000,
    dueDate: dateOffset(21),
    firstPresalesCallDaysAgo: 35,
    notes: 'Stakeholder demo scheduled end of sprint',
    ownerKeys: ['emmaId', 'sarahId'],
  },
];

for (const record of records) {
  const id = randomUUID();
  const ownerIds = record.ownerKeys.map((key) => owners[key]);
  insertOpportunity.run(
    id,
    TENANT_ID,
    record.prospect,
    record.description,
    JSON.stringify(ownerIds),
    record.deliverable,
    record.dueDate,
    record.status,
    record.notes,
    record.winOrLoss,
    dateOffset(-record.firstPresalesCallDaysAgo),
    null,
    record.prospectType,
    record.engagementType,
    record.value,
    'USD',
    record.dealStage,
    '{}',
    now,
    now
  );
  for (const ownerId of ownerIds) {
    insertRecordOwner.run(id, TENANT_ID, ownerId, now);
  }
}

console.log('Seed complete: 13 records across 8 prospects inserted.');
process.exit(0);
