import assert from "node:assert/strict";
import test from "node:test";
import {
  MF_WL_API_DEFAULT_BASE_URL,
  MF_WL_API_LEGACY_BASE_URL,
  MF_WL_API_TEST_BASE_URL,
  buildMfVatWlSearchNipUrl,
  getMfVatWlApiBaseUrl,
  getMfVatWlSearchNipPrefix,
  getMfVatWlSearchNipPrefixes,
} from "./mf-vat-wl.ts";

const ENV_KEY = "MF_WL_API_BASE_URL";

test("default VAT WL API base and search URL", () => {
  const prev = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
  try {
    assert.equal(getMfVatWlApiBaseUrl(), MF_WL_API_DEFAULT_BASE_URL);
    assert.equal(
      getMfVatWlSearchNipPrefix(),
      `${MF_WL_API_DEFAULT_BASE_URL}/search/nip`,
    );
    assert.equal(
      buildMfVatWlSearchNipUrl("7740001454", "2026-11-17"),
      `${MF_WL_API_DEFAULT_BASE_URL}/search/nip/7740001454?date=2026-11-17`,
    );
    assert.deepEqual(getMfVatWlSearchNipPrefixes(), [
      `${MF_WL_API_DEFAULT_BASE_URL}/search/nip`,
      `${MF_WL_API_LEGACY_BASE_URL}/search/nip`,
    ]);
  } finally {
    if (prev === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = prev;
  }
});

test("MF_WL_API_BASE_URL override strips trailing slashes", () => {
  const prev = process.env[ENV_KEY];
  process.env[ENV_KEY] = `${MF_WL_API_TEST_BASE_URL}/`;
  try {
    assert.equal(getMfVatWlApiBaseUrl(), MF_WL_API_TEST_BASE_URL);
    assert.equal(
      buildMfVatWlSearchNipUrl("1234567890", "2026-01-01"),
      `${MF_WL_API_TEST_BASE_URL}/search/nip/1234567890?date=2026-01-01`,
    );
    assert.deepEqual(getMfVatWlSearchNipPrefixes(), [
      `${MF_WL_API_TEST_BASE_URL}/search/nip`,
    ]);
  } finally {
    if (prev === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = prev;
  }
});

test("krsFromNip uses configured VAT WL URL (mocked fetch)", async () => {
  const prev = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
  const { resolveCapexRegistry } = await import("./krs.ts");
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    calls.push(String(input));
    return new Response(
      JSON.stringify({
        result: { subject: { name: "TEST", nip: "7740001454", krs: "123456" } },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  try {
    await resolveCapexRegistry({
      nip: "7740001454",
      fetchImpl,
      now: new Date("2026-06-01T12:00:00Z"),
    });
    assert.equal(calls.length >= 1, true);
    assert.match(
      calls[0] ?? "",
      new RegExp(
        `^${MF_WL_API_DEFAULT_BASE_URL.replace(/\./g, "\\.")}/search/nip/7740001454\\?date=`,
      ),
    );
    assert.equal(calls.filter((u) => u.includes("wl-api.mf.gov.pl")).length, 0);
  } finally {
    if (prev === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = prev;
  }
});