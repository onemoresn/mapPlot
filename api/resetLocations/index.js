// Cosmos DB Change Feed does not fire on deletes, so this function:
//  1. Deletes all documents using the SDK
//  2. Broadcasts a "reset" SignalR event directly so the host map clears instantly
const { CosmosClient } = require('@azure/cosmos');

const client    = new CosmosClient(process.env.COSMOS_DB_CONNECTION);
const container = client.database('locationmap').container('locations');

module.exports = async function (context, req) {
  const { resources } = await container.items.readAll().fetchAll();

  await Promise.all(
    resources.map(function (item) {
      return container.item(item.id, item.sessionId).delete();
    })
  );

  context.bindings.signalRMessages = [{ target: 'reset', arguments: [] }];
  context.res = { status: 200, body: { ok: true } };
};
