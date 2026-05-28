/**
 * Cache server-side sobre CacheService.
 *
 * Cada endpoint genera una key estable. Si el cliente manda ?force=1, el
 * bypass es total (lee Sheets, reescribe cache).
 *
 * Limitación de CacheService: 100 KB por entry. Si algún payload se acerca,
 * partir en chunks (no implementado todavía: ningún endpoint actual lo
 * necesita).
 */

const CACHE_KEY_PREFIX = 'ep:v1:';

/**
 * @param {string} key  identificador del endpoint (ej. 'panel_repuestos')
 * @param {object} params  params del request; mira `force` para bypass
 * @param {function} fn  closure que produce los datos cuando hay miss
 * @returns {object} { data, __cached: bool }
 */
function cachedFetch(key, params, fn) {
  const force = String(params && params.force) === '1';
  const cache = CacheService.getScriptCache();
  const cacheKey = CACHE_KEY_PREFIX + key;

  if (!force) {
    const hit = cache.get(cacheKey);
    if (hit) {
      try {
        return { data: JSON.parse(hit), __cached: true };
      } catch (_) {
        // Cache corrupta — la borramos y recomputamos.
        cache.remove(cacheKey);
      }
    }
  }

  const fresh = fn();
  try {
    cache.put(cacheKey, JSON.stringify(fresh), getCacheTTL());
  } catch (e) {
    // Probablemente excedió 100 KB. Loguear y devolver sin cachear.
    Logger.log(`[cache] no se pudo cachear ${key}: ${e.message}`);
  }
  return { data: fresh, __cached: false };
}

/** Invalida una key específica. Lo usa el endpoint refresh. */
function invalidateCacheKey(key) {
  CacheService.getScriptCache().remove(CACHE_KEY_PREFIX + key);
}

/** Invalida varias keys. */
function invalidateCacheKeys(keys) {
  CacheService.getScriptCache().removeAll((keys || []).map(k => CACHE_KEY_PREFIX + k));
}
