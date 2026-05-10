module.exports = async function (context, req) {
  const body = req.body || {};
  const { sessionId, displayName, lat, lon, locationKey } = body;

  if (!sessionId || !displayName || lat == null || lon == null || !locationKey) {
    context.res = { status: 400, body: 'Missing required fields' };
    return;
  }

  if (typeof displayName !== 'string' || displayName.length > 200) {
    context.res = { status: 400, body: 'Invalid displayName' };
    return;
  }

  const latNum = parseFloat(lat);
  const lonNum = parseFloat(lon);
  if (isNaN(latNum) || isNaN(lonNum) || latNum < -90 || latNum > 90 || lonNum < -180 || lonNum > 180) {
    context.res = { status: 400, body: 'Invalid coordinates' };
    return;
  }

  context.bindings.outputDocument = {
    id:          String(sessionId).slice(0, 64),
    sessionId:   String(sessionId).slice(0, 64),
    displayName: displayName.trim().slice(0, 200),
    lat:         latNum,
    lon:         lonNum,
    locationKey: String(locationKey).slice(0, 64),
    updatedAt:   Date.now(),
  };

  context.res = { status: 200, body: { ok: true } };
};
