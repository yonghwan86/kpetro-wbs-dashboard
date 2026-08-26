import postgres from 'postgres';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');

export const sql = postgres(process.env.DATABASE_URL, {
  ssl: 'require',
  max: 3,
  idle_timeout: 20,
  connect_timeout: 15,
  onnotice: () => {},
});
