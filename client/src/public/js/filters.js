// filters.js
export function isWithinDateRange(dateStr, startStr, endStr) {
  const date = new Date(dateStr);
  const start = new Date(startStr);
  const end = new Date(endStr);
  return date >= start && date <= end;
}

export function applyFilters(rows) {
  const daterange = document.getElementById('dateRange')?.value.trim();
  const uploader = document.getElementById('uploader')?.value.trim();
  const status = document.getElementById('status')?.value;
  const category = document.getElementById('category')?.value;

  if (rows.length === 0) {return rows;}

  const flatRows = rows.flat();

  console.log("flatRows:", flatRows);

  return flatRows.filter(r =>
    (daterange ? isWithinDateRange(
      r.updated_at.split('T')[0],
      daterange.replace(/\//g, "-").split('~')[0].trim(),
      daterange.replace(/\//g, "-").split('~')[1].trim()
    ) : true) &&
    (uploader ? r.name === uploader || uploader === "all" : true) &&
    (status ? r.status === status || status === "all" : true) &&
    (category ? r.category === category || category === "all" : true)
  );
}
