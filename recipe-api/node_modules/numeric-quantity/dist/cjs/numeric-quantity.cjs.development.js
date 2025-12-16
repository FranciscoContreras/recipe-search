"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  defaultOptions: () => defaultOptions,
  numericQuantity: () => numericQuantity,
  numericRegex: () => numericRegex,
  numericRegexWithTrailingInvalid: () => numericRegexWithTrailingInvalid,
  parseRomanNumerals: () => parseRomanNumerals,
  romanNumeralRegex: () => romanNumeralRegex,
  romanNumeralUnicodeRegex: () => romanNumeralUnicodeRegex,
  romanNumeralUnicodeToAsciiMap: () => romanNumeralUnicodeToAsciiMap,
  romanNumeralValues: () => romanNumeralValues,
  vulgarFractionToAsciiMap: () => vulgarFractionToAsciiMap,
  vulgarFractionsRegex: () => vulgarFractionsRegex
});
module.exports = __toCommonJS(src_exports);

// src/constants.ts
var vulgarFractionToAsciiMap = {
  "\xBC": "1/4",
  "\xBD": "1/2",
  "\xBE": "3/4",
  "\u2150": "1/7",
  "\u2151": "1/9",
  "\u2152": "1/10",
  "\u2153": "1/3",
  "\u2154": "2/3",
  "\u2155": "1/5",
  "\u2156": "2/5",
  "\u2157": "3/5",
  "\u2158": "4/5",
  "\u2159": "1/6",
  "\u215A": "5/6",
  "\u215B": "1/8",
  "\u215C": "3/8",
  "\u215D": "5/8",
  "\u215E": "7/8",
  "\u215F": "1/"
};
var numericRegex = /^(?=-?\s*\.\d|-?\s*\d)(-)?\s*((?:\d(?:[\d,_]*\d)?)*)(([eE][+-]?\d(?:[\d,_]*\d)?)?|\.\d(?:[\d,_]*\d)?([eE][+-]?\d(?:[\d,_]*\d)?)?|(\s+\d(?:[\d,_]*\d)?\s*)?\s*\/\s*\d(?:[\d,_]*\d)?)?$/;
var numericRegexWithTrailingInvalid = new RegExp(
  numericRegex.source.replace(/\$$/, "(?:\\s*[^\\.\\d\\/].*)?")
);
var vulgarFractionsRegex = new RegExp(
  `(${Object.keys(vulgarFractionToAsciiMap).join("|")})`
);
var romanNumeralValues = {
  MMM: 3e3,
  MM: 2e3,
  M: 1e3,
  CM: 900,
  DCCC: 800,
  DCC: 700,
  DC: 600,
  D: 500,
  CD: 400,
  CCC: 300,
  CC: 200,
  C: 100,
  XC: 90,
  LXXX: 80,
  LXX: 70,
  LX: 60,
  L: 50,
  XL: 40,
  XXX: 30,
  XX: 20,
  XII: 12,
  // only here for tests; not used in practice
  XI: 11,
  // only here for tests; not used in practice
  X: 10,
  IX: 9,
  VIII: 8,
  VII: 7,
  VI: 6,
  V: 5,
  IV: 4,
  III: 3,
  II: 2,
  I: 1
};
var romanNumeralUnicodeToAsciiMap = {
  // Roman Numeral One (U+2160)
  "\u2160": "I",
  // Roman Numeral Two (U+2161)
  "\u2161": "II",
  // Roman Numeral Three (U+2162)
  "\u2162": "III",
  // Roman Numeral Four (U+2163)
  "\u2163": "IV",
  // Roman Numeral Five (U+2164)
  "\u2164": "V",
  // Roman Numeral Six (U+2165)
  "\u2165": "VI",
  // Roman Numeral Seven (U+2166)
  "\u2166": "VII",
  // Roman Numeral Eight (U+2167)
  "\u2167": "VIII",
  // Roman Numeral Nine (U+2168)
  "\u2168": "IX",
  // Roman Numeral Ten (U+2169)
  "\u2169": "X",
  // Roman Numeral Eleven (U+216A)
  "\u216A": "XI",
  // Roman Numeral Twelve (U+216B)
  "\u216B": "XII",
  // Roman Numeral Fifty (U+216C)
  "\u216C": "L",
  // Roman Numeral One Hundred (U+216D)
  "\u216D": "C",
  // Roman Numeral Five Hundred (U+216E)
  "\u216E": "D",
  // Roman Numeral One Thousand (U+216F)
  "\u216F": "M",
  // Small Roman Numeral One (U+2170)
  "\u2170": "I",
  // Small Roman Numeral Two (U+2171)
  "\u2171": "II",
  // Small Roman Numeral Three (U+2172)
  "\u2172": "III",
  // Small Roman Numeral Four (U+2173)
  "\u2173": "IV",
  // Small Roman Numeral Five (U+2174)
  "\u2174": "V",
  // Small Roman Numeral Six (U+2175)
  "\u2175": "VI",
  // Small Roman Numeral Seven (U+2176)
  "\u2176": "VII",
  // Small Roman Numeral Eight (U+2177)
  "\u2177": "VIII",
  // Small Roman Numeral Nine (U+2178)
  "\u2178": "IX",
  // Small Roman Numeral Ten (U+2179)
  "\u2179": "X",
  // Small Roman Numeral Eleven (U+217A)
  "\u217A": "XI",
  // Small Roman Numeral Twelve (U+217B)
  "\u217B": "XII",
  // Small Roman Numeral Fifty (U+217C)
  "\u217C": "L",
  // Small Roman Numeral One Hundred (U+217D)
  "\u217D": "C",
  // Small Roman Numeral Five Hundred (U+217E)
  "\u217E": "D",
  // Small Roman Numeral One Thousand (U+217F)
  "\u217F": "M"
};
var romanNumeralUnicodeRegex = new RegExp(
  `(${Object.keys(romanNumeralUnicodeToAsciiMap).join("|")})`,
  "gi"
);
var romanNumeralRegex = /^(?=[MDCLXVI])(M{0,3})(C[MD]|D?C{0,3})(X[CL]|L?X{0,3})(I[XV]|V?I{0,3})$/i;
var defaultOptions = {
  round: 3,
  allowTrailingInvalid: false,
  romanNumerals: false,
  bigIntOnOverflow: false
};

// src/parseRomanNumerals.ts
var parseRomanNumerals = (romanNumerals) => {
  const normalized = `${romanNumerals}`.replace(
    romanNumeralUnicodeRegex,
    (_m, rn) => romanNumeralUnicodeToAsciiMap[rn]
  ).toUpperCase();
  const regexResult = romanNumeralRegex.exec(normalized);
  if (!regexResult) {
    return NaN;
  }
  const [, thousands, hundreds, tens, ones] = regexResult;
  return (romanNumeralValues[thousands] ?? 0) + (romanNumeralValues[hundreds] ?? 0) + (romanNumeralValues[tens] ?? 0) + (romanNumeralValues[ones] ?? 0);
};

// src/numericQuantity.ts
var spaceThenSlashRegex = /^\s*\//;
function numericQuantity(quantity, options = defaultOptions) {
  if (typeof quantity === "number" || typeof quantity === "bigint") {
    return quantity;
  }
  let finalResult = NaN;
  const quantityAsString = `${quantity}`.replace(
    vulgarFractionsRegex,
    (_m, vf) => ` ${vulgarFractionToAsciiMap[vf]}`
  ).replace("\u2044", "/").trim();
  if (quantityAsString.length === 0) {
    return NaN;
  }
  const opts = {
    ...defaultOptions,
    ...options
  };
  const regexResult = (opts.allowTrailingInvalid ? numericRegexWithTrailingInvalid : numericRegex).exec(quantityAsString);
  if (!regexResult) {
    return opts.romanNumerals ? parseRomanNumerals(quantityAsString) : NaN;
  }
  const [, dash, ng1temp, ng2temp] = regexResult;
  const numberGroup1 = ng1temp.replace(/[,_]/g, "");
  const numberGroup2 = ng2temp?.replace(/[,_]/g, "");
  if (!numberGroup1 && numberGroup2 && numberGroup2.startsWith(".")) {
    finalResult = 0;
  } else {
    if (opts.bigIntOnOverflow) {
      const asBigInt = dash ? BigInt(`-${numberGroup1}`) : BigInt(numberGroup1);
      if (asBigInt > BigInt(Number.MAX_SAFE_INTEGER) || asBigInt < BigInt(Number.MIN_SAFE_INTEGER)) {
        return asBigInt;
      }
    }
    finalResult = parseInt(numberGroup1);
  }
  if (!numberGroup2) {
    return dash ? finalResult * -1 : finalResult;
  }
  const roundingFactor = opts.round === false ? NaN : parseFloat(`1e${Math.floor(Math.max(0, opts.round))}`);
  if (numberGroup2.startsWith(".") || numberGroup2.startsWith("e") || numberGroup2.startsWith("E")) {
    const decimalValue = parseFloat(`${finalResult}${numberGroup2}`);
    finalResult = isNaN(roundingFactor) ? decimalValue : Math.round(decimalValue * roundingFactor) / roundingFactor;
  } else if (spaceThenSlashRegex.test(numberGroup2)) {
    const numerator = parseInt(numberGroup1);
    const denominator = parseInt(numberGroup2.replace("/", ""));
    finalResult = isNaN(roundingFactor) ? numerator / denominator : Math.round(numerator * roundingFactor / denominator) / roundingFactor;
  } else {
    const fractionArray = numberGroup2.split("/");
    const [numerator, denominator] = fractionArray.map((v) => parseInt(v));
    finalResult += isNaN(roundingFactor) ? numerator / denominator : Math.round(numerator * roundingFactor / denominator) / roundingFactor;
  }
  return dash ? finalResult * -1 : finalResult;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  defaultOptions,
  numericQuantity,
  numericRegex,
  numericRegexWithTrailingInvalid,
  parseRomanNumerals,
  romanNumeralRegex,
  romanNumeralUnicodeRegex,
  romanNumeralUnicodeToAsciiMap,
  romanNumeralValues,
  vulgarFractionToAsciiMap,
  vulgarFractionsRegex
});
//# sourceMappingURL=numeric-quantity.cjs.development.js.map