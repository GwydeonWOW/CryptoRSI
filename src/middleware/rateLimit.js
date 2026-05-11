/**
 * Rate Limiting Configuration
 */

const rateLimit = require('express-rate-limit');

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many login attempts, please try again later' },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded' },
});

/**
 * Reset rate limit for a specific IP.
 * Works with express-rate-limit's internal store.
 */
function resetRateLimit(ip) {
  const key = `${authLimiter.windowMs}:${ip}`;
  if (authLimiter.store && authLimiter.store.resetKey) {
    authLimiter.store.resetKey(key);
    return true;
  }
  return false;
}

/**
 * Get all rate-limited IPs from the auth limiter.
 */
function getRateLimitedIPs() {
  const results = [];
  if (authLimiter.store && typeof authLimiter.store.forEach === 'function') {
    authLimiter.store.forEach((key, value) => {
      if (value && value.totalHits > 0) {
        results.push({
          key,
          hits: value.totalHits || value,
          resetTime: value.resetTime || null,
        });
      }
    });
  }
  return results;
}

module.exports = { globalLimiter, authLimiter, apiLimiter, resetRateLimit, getRateLimitedIPs };
