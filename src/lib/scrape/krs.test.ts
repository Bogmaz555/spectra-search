import assert from "node:assert/strict";
import test from "node:test";
import {
  CEIDG_LIMIT_NOTE,
  extractRegistryIds,
  isValidNip,
  normalizeKrs,
  parseKrsOdpis,
  resolveCapexRegistry,
  scrubPersonalIds,
  warsawDate,
} from "./krs.ts";

const FIXTURE = {
  odpis: {
    naglowekA: { numerKRS: "0000123456", rejestr: "RejP" },
    dane: {
      dzial1: {
        danePodmiotu: {
          nazwa: "PRZYKŁAD SPÓŁKA Z O.O.",
          identyfikatory: { nip: "7740001454", regon: "123456785" },
        },
      },
      dzial2: {
        reprezentacja: {
          nazwaOrganu: "ZARZĄD",
          sposobReprezentacji: "KAŻDY CZŁONEK ZARZĄDU SAMODZIELNIE",
          sklad: [
            {
              nazwisko: { nazwiskoICzlon: "KOWALSKI", nazwiskoIICzlon: "NOWAK" },
              imiona: { imie: "JAN", imieDrugie: "ADAM" },
              identyfikator: { pesel: "80010112345" },
              funkcjaWOrganie: "PREZES ZARZĄDU",
              czyZawieszona: false,
            },
            {
              nazwisko: { nazwiskoICzlon: "WIŚNIEWSKA" },
              imiona: { imie: "ANNA" },
              identyfikator: { pesel: "90010112345" },
              funkcjaWOrganie: "CZŁONEK ZARZĄDU",
              czyZawieszona: true,
            },
          ],
        },
        prokurenci: [
          {
            nazwisko: { nazwiskoICzlon: "ZIELIŃSKI" },
            imiona: { imie: "PIOTR" },
            identyfikator: { pesel: "70010112345" },
            rodzajProkury: "PROKURA SAMOISTNA. PESEL:70010112345 oraz PESEL: 80010112345",
          },
        ],
      },
    },
  },
};

test("NIP checksum and KRS padding", () => {
  assert.equal(isValidNip("7740001454"), true);
  assert.equal(isValidNip("1234567890"), false);
  assert.equal(normalizeKrs("28860"), "0000028860");
  assert.equal(normalizeKrs("0000000000"), null);
});

test("labeled KRS and NIP are read from page text", () => {
  const ids = extractRegistryIds(
    "Siedziba. KRS: 0000123456, NIP 774-000-14-54. Faktura 1234567890.",
  );
  assert.equal(ids.krs, "0000123456");
  assert.equal(ids.nip, "7740001454");
  assert.deepEqual(extractRegistryIds("sam numer 7740001454 bez etykiety"), {});
});

test("KRS extract keeps board and proxies and drops PESEL", () => {
  const parsed = parseKrsOdpis(FIXTURE, "0000123456", "https://api-krs.ms.gov.pl/example");
  assert.ok(parsed);
  assert.equal(parsed?.name, "PRZYKŁAD SPÓŁKA Z O.O.");
  assert.equal(parsed?.people.filter((person) => person.kind === "zarzad").length, 2);
  assert.equal(
    parsed?.people.find((person) => person.kind === "prokurent")?.name,
    "PIOTR ZIELIŃSKI",
  );
  assert.match(parsed?.people[0]?.name ?? "", /JAN ADAM KOWALSKI NOWAK/);
  assert.match(parsed?.people[1]?.role ?? "", /zawieszone/);
  const blob = JSON.stringify(parsed);
  assert.equal(blob.includes("80010112345"), false);
  assert.equal(blob.includes("70010112345"), false);
  assert.equal(blob.includes("90010112345"), false);
  assert.equal(blob.toLowerCase().includes("pesel"), false);
  assert.match(parsed?.markdown ?? "", /## Zarząd/);
  assert.match(parsed?.markdown ?? "", /## Prokurenci/);
});

test("scrub removes PESEL written into a prokura clause", () => {
  const clean = scrubPersonalIds("PROKURA ŁĄCZNA (PESEL: 82010112345)");
  assert.equal(clean.includes("82010112345"), false);
  assert.equal(clean.toLowerCase().includes("pesel"), false);
});

test("KRS lookup tries register P, then S", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("rejestr=P")) return new Response("{}", { status: 404 });
    if (url.includes("rejestr=S")) {
      return new Response(JSON.stringify(FIXTURE), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("no", { status: 500 });
  };
  const registry = await resolveCapexRegistry({ krs: "123456", fetchImpl });
  assert.equal(registry.krs, "0000123456");
  assert.equal(registry.people.length, 3);
  assert.equal(
    calls.some((url) => url.includes("rejestr=P")),
    true,
  );
  assert.equal(
    calls.some((url) => url.includes("rejestr=S")),
    true,
  );
  assert.equal(
    calls.some((url) => url.toLowerCase().includes("ceidg")),
    false,
  );
});

test("NIP without a KRS number stops at the CEIDG limit", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/search/nip/")) {
      return new Response(
        JSON.stringify({
          result: { subject: { name: "JAN NOWAK", nip: "7740001454", krs: null } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("unexpected", { status: 500 });
  };
  const registry = await resolveCapexRegistry({
    nip: "7740001454",
    fetchImpl,
    now: new Date("2026-11-05T23:30:00Z"),
  });
  assert.equal(registry.people.length, 0);
  assert.equal(registry.krs, undefined);
  assert.equal(registry.note, CEIDG_LIMIT_NOTE);
  assert.match(calls[0] ?? "", /date=2026-11-06/);
  assert.equal(
    calls.some((url) => url.includes("OdpisAktualny")),
    false,
  );
  assert.equal(
    calls.some((url) => url.toLowerCase().includes("ceidg")),
    false,
  );
  assert.equal(warsawDate(new Date("2026-11-05T23:30:00Z")), "2026-11-06");
});

test("NIP on the VAT whitelist is followed by a KRS extract", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("wykazpodatnikowvat")) {
      return new Response(
        JSON.stringify({
          result: { subject: { name: "PRZYKŁAD", nip: "7740001454", krs: "123456" } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("OdpisAktualny/0000123456")) {
      return new Response(JSON.stringify(FIXTURE), { status: 200 });
    }
    return new Response("no", { status: 404 });
  };
  const registry = await resolveCapexRegistry({ nip: "774-000-14-54", fetchImpl });
  assert.equal(registry.krs, "0000123456");
  assert.equal(registry.people.length, 3);
  assert.equal(registry.note, undefined);
  assert.equal(
    calls.some((url) => url.toLowerCase().includes("ceidg")),
    false,
  );
  assert.equal(calls.filter((url) => url.includes("wl-api.mf.gov.pl")).length, 0);
});
