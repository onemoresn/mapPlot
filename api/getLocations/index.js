module.exports = async function (context, req, documents) {
  context.res = { body: documents || [] };
};
