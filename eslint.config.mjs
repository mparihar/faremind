import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Flight-time fields. A value under one of these names is an airport wall clock
// with no timezone, so `new Date(...)` on it silently means something different
// on every machine. See src/lib/provider-time.ts for the whole story.
const FLIGHT_TIME_FIELD =
  "/^(departureDate|arrivalDate|departureTime|arrivalTime|departureDateTime|arrivalDateTime|depTime|arrTime|departure_time_local|arrival_time_local)$/";

const PARSE_MSG =
  "Flight times are airport wall-clock with no zone — `new Date()` reads them in the machine's timezone, " +
  "so the same booking lands on a different instant per server (this shipped a flight a day late: FMP6VJN2). " +
  "Use parseProviderDateTime / parseProviderDateTimeOr from @/lib/provider-time.";

const RENDER_MSG =
  "Rendering a flight time without `timeZone: 'UTC'` re-converts it into the viewer's zone, so a Madrid " +
  "customer sees the wrong departure. Use formatFlightDate / formatFlightTime / formatFlightDateTime from @/lib/provider-time.";

const HOUR_MSG =
  "getHours()/getMinutes() project into the runtime's timezone, which moves red-eye and time-of-day scoring " +
  "into the wrong band on a non-UTC host. Use providerHour / providerMinute from @/lib/provider-time.";

const flightTimeRules = {
  "no-restricted-syntax": [
    "error",
    // new Date(x.departureTime) — the field is named outright.
    {
      selector: `NewExpression[callee.name='Date'] > MemberExpression[property.name=${FLIGHT_TIME_FIELD}]`,
      message: PARSE_MSG,
    },
    // new Date(seg.departure.time) / new Date(x.arrival.time)
    {
      selector: `NewExpression[callee.name='Date'] > MemberExpression[property.name='time'] > MemberExpression[property.name=/^(departure|arrival)$/]`,
      message: PARSE_MSG,
    },
    // x.departureTime.toLocaleDateString(...) and friends, on a flight field.
    {
      selector: `CallExpression[callee.property.name=/^toLocale(Date|Time|)String$/] > MemberExpression[object.property.name=${FLIGHT_TIME_FIELD}]`,
      message: RENDER_MSG,
    },
    // x.departureTime.getHours() — wall-clock reads must not go through local.
    {
      selector: `CallExpression[callee.property.name=/^get(Hours|Minutes|Date|Day|Month|FullYear)$/] > MemberExpression[object.property.name=${FLIGHT_TIME_FIELD}]`,
      message: HOUR_MSG,
    },
  ],
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: ["src/**/*.{ts,tsx}"],
    // provider-time.ts is the one file allowed to touch raw Date parsing — it is
    // the implementation everything else is being pointed at.
    ignores: ["src/lib/provider-time.ts"],
    rules: flightTimeRules,
  },
]);

export default eslintConfig;
