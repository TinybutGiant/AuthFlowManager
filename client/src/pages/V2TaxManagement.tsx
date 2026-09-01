import FinanceTaxPanel, { type TaxRequestJson } from "./FinanceTaxPanel";

const V2_TAX_BASE = "/api/v2/tax";

const v2TaxRequestJson: TaxRequestJson = async <T,>(
  method: string,
  url: string,
  body?: unknown,
): Promise<T> => {
  const headers = new Headers();
  headers.set("Accept", "application/json");
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      json && typeof json === "object" && "message" in json
        ? String((json as { message: unknown }).message)
        : response.statusText;
    const code =
      json && typeof json === "object" && "code" in json
        ? String((json as { code: unknown }).code)
        : message;
    throw new Error(`${code}: ${message}`);
  }

  return json as T;
};

export default function V2TaxManagement() {
  return (
    <FinanceTaxPanel
      apiBase={V2_TAX_BASE}
      requestJson={v2TaxRequestJson}
    />
  );
}
