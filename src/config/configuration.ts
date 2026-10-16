export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  apiPrefix: process.env.API_PREFIX || '/api/v1',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  database: {
    url: process.env.DATABASE_URL,
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev-insecure-access-secret-replace-in-production-min-32-chars',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-insecure-refresh-secret-replace-in-production-min-32-chars',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },
  logging: {
    level: process.env.LOG_LEVEL || 'debug',
  },
});
