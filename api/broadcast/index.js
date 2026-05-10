// Fires on every Cosmos DB create/update via the Change Feed.
// Broadcasts each changed document to all SignalR clients (host view).
module.exports = async function (context, documents) {
  context.bindings.signalRMessages = documents.map(function (doc) {
    return {
      target: 'locationUpdate',
      arguments: [{
        id:          doc.id,
        sessionId:   doc.sessionId,
        displayName: doc.displayName,
        lat:         doc.lat,
        lon:         doc.lon,
        locationKey: doc.locationKey,
        updatedAt:   doc.updatedAt,
      }],
    };
  });
};
