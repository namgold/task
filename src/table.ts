export function renderTable(headers: string[], rows: string[][], emptyMessage = 'No items found.'): string {
  if (rows.length === 0) {
    return emptyMessage;
  }

  const widths = headers.map((header, columnIndex) =>
    Math.max(header.length, ...rows.map((row) => row[columnIndex]?.length ?? 0))
  );

  const formatRow = (row: string[]): string =>
    row.map((cell, index) => cell.padEnd(widths[index], ' ')).join('  ');

  return [formatRow(headers), ...rows.map(formatRow)].join('\n');
}
