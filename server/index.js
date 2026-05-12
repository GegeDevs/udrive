import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from './config.js';
import { errorHandler } from './middleware/error-handler.js';
import { authenticate, requireAuth, requirePermission } from './middleware/auth.js';
import { startKeepAliveScheduler } from './services/keep-alive.js';
import authRoutes from './routes/auth.js';
import accountRoutes from './routes/accounts.js';
import fileRoutes from './routes/files.js';
import settingsRoutes from './routes/settings.js';
import userRoutes from './routes/users.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors({ credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(authenticate);

const distPath = join(__dirname, '..', 'dist');
app.use(express.static(distPath));

app.use('/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/accounts', requireAuth, requirePermission('action:manage_accounts'), accountRoutes);
app.use('/api/files', requireAuth, fileRoutes);
app.use('/api/settings', requireAuth, settingsRoutes);

app.get('*', (req, res) => {
  res.sendFile(join(distPath, 'index.html'));
});

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`UDrive server running on http://localhost:${config.port}`);
  startKeepAliveScheduler();
});
