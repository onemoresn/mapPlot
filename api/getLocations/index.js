const { CosmosClient } = require('@azure/cosmos');

const client    = new CosmosClient(process.env.COSMOS_DB_CONNECTION);
const container = client.database('locationmap').container('locations');

module.exports = async function (context, req) {
  try {
    const { resources } = await container.items
      .query('SELECT c.id, c.sessionId, c.displayName, c.lat, c.lon, c.locationKey, c.updatedAt FROM c')
      .fetchAll();
    context.res = { body: resources || [] };
  } catch (err) {
    context.log.error('getLocations error:', err.message);
    context.res = { body: [] };
  }
};
