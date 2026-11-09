import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config({ path: ['.env.local', '.env'] });

const configuredPoolSize = Number(process.env.MARIADB_POOL_SIZE || 1);
// Vercel creates multiple warm function instances. Keep each instance's
// connection footprint deliberately small for Layerbase's 20-client Free cap.
const connectionLimit = Number.isFinite(configuredPoolSize)
  ? Math.min(Math.max(Math.floor(configuredPoolSize), 1), 2)
  : 1;

export const pool = mysql.createPool({
  host: process.env.MARIADB_HOST || '127.0.0.1',
  port: Number(process.env.MARIADB_PORT || 3306),
  user: process.env.MARIADB_USER,
  password: process.env.MARIADB_PASSWORD,
  database: process.env.MARIADB_DATABASE,
  waitForConnections: true,
  connectionLimit,
  maxIdle: 1,
  idleTimeout: 5000,
  connectTimeout: 30000,
  queueLimit: 50,
  ssl: process.env.MARIADB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  charset: 'utf8mb4',
  timezone: 'Z',
  decimalNumbers: true,
});
