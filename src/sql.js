// Builds "col = $n, ..." for a PATCH from a whitelist: column names come only from the
// whitelist, values only as bind parameters. `values` already holds the fixed parameters
// ($1 = id, …), so numbering continues after them.
function buildSet(patch, whitelist, values) {
  const sets = [];
  for (const [field, column] of Object.entries(whitelist)) {
    if (patch[field] !== undefined) {
      values.push(patch[field]);
      sets.push(`${column} = $${values.length}`);
    }
  }
  return sets.join(', ');
}

module.exports = { buildSet };
