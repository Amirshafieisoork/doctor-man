// A reservation must outlive the server function's maximum duration. The
// deployment currently stops requests well before this 15-minute lease expires.
export const LAB_QUOTA_RESERVATION_TTL_SECONDS = 900;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = value => typeof value === 'string' && uuidPattern.test(value);

function quotaError(code, cause) {
  return new Error(code, cause ? { cause } : undefined);
}

/** Reserve one monthly analysis before any paid model request. Fail closed. */
export async function reserveLabAnalysisQuota(db, userId, {
  limit,
  ttlSeconds = LAB_QUOTA_RESERVATION_TTL_SECONDS
} = {}) {
  if (!isUuid(userId) || !Number.isInteger(limit) || limit < 0 || limit > 100000
    || !Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 3600) {
    throw quotaError('INVALID_QUOTA_INPUT');
  }

  let response;
  try {
    response = await db.rpc('reserve_lab_analysis_quota', {
      p_user_id: userId,
      p_limit: limit,
      p_ttl_seconds: ttlSeconds
    });
  } catch (error) {
    throw quotaError('QUOTA_UNAVAILABLE', error);
  }
  if (response?.error) throw quotaError('QUOTA_UNAVAILABLE', response.error);

  const rows = Array.isArray(response?.data) ? response.data : [response?.data];
  const reservation = rows.length === 1 ? rows[0] : null;
  if (reservation?.allowed === false && reservation.reservation_id === null
    && reservation.remaining === 0 && reservation.expires_at === null
    && reservation.reserved_at === null) {
    throw quotaError('QUOTA_EXCEEDED');
  }
  const remaining = reservation?.remaining;
  const expiry = Date.parse(reservation?.expires_at);
  const reserved = Date.parse(reservation?.reserved_at);
  if (reservation?.allowed !== true || !isUuid(reservation.reservation_id)
    || !Number.isFinite(expiry) || expiry <= Date.now()
    || !Number.isFinite(reserved) || reserved >= expiry
    || !Number.isSafeInteger(remaining) || remaining < 0 || remaining >= limit) {
    throw quotaError('QUOTA_UNAVAILABLE');
  }

  return {
    reservationId: reservation.reservation_id,
    remaining,
    expiresAt: reservation.expires_at,
    reservedAt: reservation.reserved_at
  };
}

/** Release only after the result is persisted, or when the analysis fails. */
export async function releaseLabAnalysisQuota(db, userId, reservationId) {
  if (!isUuid(userId) || !isUuid(reservationId)) throw quotaError('INVALID_QUOTA_INPUT');
  try {
    const { error } = await db.from('ai_analysis_reservations').delete()
      .eq('user_id', userId).eq('id', reservationId);
    if (error) throw error;
  } catch (error) {
    // The caller should log this without replacing its response. The lease
    // expires automatically and cannot grant extra analyses while it remains.
    throw quotaError('QUOTA_RELEASE_FAILED', error);
  }
}
