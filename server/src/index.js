import { migrate } from './db.js';
import { PORT } from './constants.js';
import { createApp } from './createApp.js';
import {
  migrateRetiredCaseStudySchemaFields,
  migrateLegacyOwnerIds,
} from './startup/migrations.js';
import {
  seedUsersIfEmpty,
  ensureDefaultPlatformAdminOnly,
  seedLookupsIfEmpty,
  seedDealStagesIfEmpty,
  seedDefaultAppConfigIfEmpty,
  seedIfEmpty,
} from './startup/seeds.js';
import { runNotificationEvaluator } from './services/notificationService.js';

migrate();
migrateRetiredCaseStudySchemaFields();
migrateLegacyOwnerIds();
seedUsersIfEmpty();
ensureDefaultPlatformAdminOnly();
seedLookupsIfEmpty();
seedDealStagesIfEmpty();
seedDefaultAppConfigIfEmpty();
seedIfEmpty();

const { app, serveStatic } = createApp();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Listening on port ${PORT}${serveStatic ? ' (API + static SPA)' : ' (API only)'}`);
});

setInterval(runNotificationEvaluator, 60 * 1000);
runNotificationEvaluator();
