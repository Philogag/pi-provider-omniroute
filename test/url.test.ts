import { test } from "node:test";
import assert from "node:assert/strict";
import { OMNIROUTE_DEFAULT_BASE_URL, validateAndNormalizeBaseUrl } from "../src/auth.ts";

test("validateAndNormalizeBaseUrl: empty string returns default", () => {
  assert.equal(validateAndNormalizeBaseUrl(""), OMNIROUTE_DEFAULT_BASE_URL);
});

test("validateAndNormalizeBaseUrl: whitespace-only returns default", () => {
  assert.equal(validateAndNormalizeBaseUrl("   "), OMNIROUTE_DEFAULT_BASE_URL);
});

test("validateAndNormalizeBaseUrl: valid http URL returned trimmed", () => {
  assert.equal(
    validateAndNormalizeBaseUrl("http://localhost:20128/v1"),
    "http://localhost:20128/v1",
  );
});

test("validateAndNormalizeBaseUrl: valid https URL returned as-is", () => {
  assert.equal(
    validateAndNormalizeBaseUrl("https://router.example.com/v1"),
    "https://router.example.com/v1",
  );
});

test("validateAndNormalizeBaseUrl: trailing slash preserved", () => {
  assert.equal(
    validateAndNormalizeBaseUrl("https://router.example.com/v1/"),
    "https://router.example.com/v1/",
  );
});

test("validateAndNormalizeBaseUrl: surrounding whitespace trimmed", () => {
  assert.equal(
    validateAndNormalizeBaseUrl("  https://router.example.com/v1  "),
    "https://router.example.com/v1",
  );
});

test("validateAndNormalizeBaseUrl: rejects missing protocol", () => {
  assert.throws(
    () => validateAndNormalizeBaseUrl("localhost:20128"),
    /must use http\(s\)/,
  );
});

test("validateAndNormalizeBaseUrl: rejects non-http(s) protocol", () => {
  assert.throws(
    () => validateAndNormalizeBaseUrl("ftp://router.example.com"),
    /must use http\(s\)/,
  );
});

test("validateAndNormalizeBaseUrl: rejects missing hostname", () => {
  assert.throws(
    () => validateAndNormalizeBaseUrl("http://"),
    /Invalid base URL/,
  );
});

test("OMNIROUTE_DEFAULT_BASE_URL is http://localhost:20128/v1", () => {
  assert.equal(OMNIROUTE_DEFAULT_BASE_URL, "http://localhost:20128/v1");
});
