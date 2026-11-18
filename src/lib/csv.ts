// Pure. Minimal RFC 4180 reader shared by the BGG ranks dump and collection exports.

/** Records: quoted fields may hold commas, doubled quotes and line breaks. Blank lines are skipped. */
export function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      field = "";
      if (record.some((f) => f !== "")) records.push(record);
      record = [];
    } else field += c;
  }
  record.push(field);
  if (record.some((f) => f !== "")) records.push(record);
  return records;
}
