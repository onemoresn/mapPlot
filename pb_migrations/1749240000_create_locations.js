/// <reference path="../pb_data/types.d.ts" />

// Auto-creates the "locations" collection with fully public access rules.
// PocketBase runs this once on first startup — no manual admin setup needed.
migrate((db) => {
  const collection = new Collection({
    name: "locations",
    type: "base",
    schema: [
      {
        name:     "session_id",
        type:     "text",
        required: true,
        options:  { max: 64 },
      },
      {
        name:     "display_name",
        type:     "text",
        required: true,
        options:  { max: 200 },
      },
      {
        name:     "lat",
        type:     "number",
        required: true,
        options:  { min: -90, max: 90 },
      },
      {
        name:     "lon",
        type:     "number",
        required: true,
        options:  { min: -180, max: 180 },
      },
      {
        name:     "location_key",
        type:     "text",
        required: true,
        options:  { max: 64 },
      },
    ],
    // Empty string = public (no auth required)
    listRule:   "",
    viewRule:   "",
    createRule: "",
    updateRule: "",
    deleteRule: "",
  });

  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao        = new Dao(db);
  const collection = dao.findCollectionByNameOrId("locations");
  return dao.deleteCollection(collection);
});
