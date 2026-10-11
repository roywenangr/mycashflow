import { JWT } from "google-auth-library";
import type { Expense } from "@/lib/db/schema";

const API = "https://sheets.googleapis.com/v4/spreadsheets";
const HEADER = [
  "ID",
  "Tanggal",
  "Jumlah",
  "Kategori",
  "Deskripsi",
  "Merchant",
  "Sumber",
];

export function isSheetsConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SHEET_ID &&
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    process.env.GOOGLE_PRIVATE_KEY,
  );
}

let client: JWT | null = null;

function getClient(): JWT {
  if (!client) {
    client = new JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      // Env vars store the PEM newlines escaped.
      key: process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
  }
  return client;
}

async function sheetsFetch(path: string, init?: RequestInit) {
  const { token } = await getClient().getAccessToken();
  const res = await fetch(`${API}/${process.env.GOOGLE_SHEET_ID}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`Google Sheets ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// Stop free text from being evaluated as a formula under USER_ENTERED.
function safeText(value: string | null): string {
  if (!value) return "";
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function toRow(expense: Expense) {
  return [
    expense.id,
    expense.spentOn,
    expense.amount,
    expense.category,
    safeText(expense.description),
    safeText(expense.merchant),
    expense.source === "receipt" ? "Struk" : "Chat",
  ];
}

/** Appends expenses to the first tab, writing the header row if the sheet is empty. */
export async function appendExpenses(rows: Expense[]): Promise<void> {
  if (rows.length === 0) return;

  const first = await sheetsFetch("/values/A1:A1");
  const values = first.values ? rows.map(toRow) : [HEADER, ...rows.map(toRow)];

  await sheetsFetch(
    "/values/A:G:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS",
    { method: "POST", body: JSON.stringify({ values }) },
  );
}

/** Removes the row whose ID column matches. No-op if the row is not found. */
export async function removeExpense(id: number): Promise<void> {
  const [ids, meta] = await Promise.all([
    sheetsFetch("/values/A:A"),
    sheetsFetch("?fields=sheets.properties(sheetId,index)"),
  ]);

  const rowIndex = (ids.values as string[][] | undefined)?.findIndex(
    (row) => row[0] === String(id),
  );
  if (rowIndex === undefined || rowIndex < 0) return;

  const sheets = meta.sheets as {
    properties: { sheetId: number; index: number };
  }[];
  const sheetId = sheets.find((s) => s.properties.index === 0)?.properties
    .sheetId;
  if (sheetId === undefined) return;

  await sheetsFetch(":batchUpdate", {
    method: "POST",
    body: JSON.stringify({
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: rowIndex,
              endIndex: rowIndex + 1,
            },
          },
        },
      ],
    }),
  });
}
