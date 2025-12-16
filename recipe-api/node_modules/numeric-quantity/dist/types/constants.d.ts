import type { NumericQuantityOptions, RomanNumeralAscii, RomanNumeralUnicode, VulgarFraction } from "./types";
/**
* Map of Unicode fraction code points to their ASCII equivalents.
*/
export declare const vulgarFractionToAsciiMap: Record<VulgarFraction, `${number}/${number | ""}`>;
/**
* Captures the individual elements of a numeric string.
*
* Capture groups:
*
* |  #  |    Description                                   |        Example(s)                                                   |
* | --- | ------------------------------------------------ | ------------------------------------------------------------------- |
* | `0` | entire string                                    | `"2 1/3"` from `"2 1/3"`                                            |
* | `1` | "negative" dash                                  | `"-"` from `"-2 1/3"`                                               |
* | `2` | whole number or numerator                        | `"2"` from `"2 1/3"`; `"1"` from `"1/3"`                            |
* | `3` | entire fraction, decimal portion, or denominator | `" 1/3"` from `"2 1/3"`; `".33"` from `"2.33"`; `"/3"` from `"1/3"` |
*
* _Capture group 2 may include comma/underscore separators._
*
* @example
*
* ```ts
* numericRegex.exec("1")     // [ "1",     "1", null,   null ]
* numericRegex.exec("1.23")  // [ "1.23",  "1", ".23",  null ]
* numericRegex.exec("1 2/3") // [ "1 2/3", "1", " 2/3", " 2" ]
* numericRegex.exec("2/3")   // [ "2/3",   "2", "/3",   null ]
* numericRegex.exec("2 / 3") // [ "2 / 3", "2", "/ 3",  null ]
* ```
*/
export declare const numericRegex: RegExp;
/**
* Same as {@link numericRegex}, but allows (and ignores) trailing invalid characters.
*/
export declare const numericRegexWithTrailingInvalid: RegExp;
/**
* Captures any Unicode vulgar fractions.
*/
export declare const vulgarFractionsRegex: RegExp;
type RomanNumeralSequenceFragment = `${RomanNumeralAscii}` | `${RomanNumeralAscii}${RomanNumeralAscii}` | `${RomanNumeralAscii}${RomanNumeralAscii}${RomanNumeralAscii}` | `${RomanNumeralAscii}${RomanNumeralAscii}${RomanNumeralAscii}${RomanNumeralAscii}`;
/**
* Map of Roman numeral sequences to their decimal equivalents.
*/
export declare const romanNumeralValues: { [k in RomanNumeralSequenceFragment]? : number };
/**
* Map of Unicode Roman numeral code points to their ASCII equivalents.
*/
export declare const romanNumeralUnicodeToAsciiMap: Record<RomanNumeralUnicode, keyof typeof romanNumeralValues>;
/**
* Captures all Unicode Roman numeral code points.
*/
export declare const romanNumeralUnicodeRegex: RegExp;
/**
* Captures a valid Roman numeral sequence.
*
* Capture groups:
*
* |  #  |  Description    |         Example          |
* | --- | --------------- | ------------------------ |
* | `0` |  Entire string  |  "MCCXIV" from "MCCXIV"  |
* | `1` |  Thousands      |  "M" from "MCCXIV"       |
* | `2` |  Hundreds       |  "CC" from "MCCXIV"      |
* | `3` |  Tens           |  "X" from "MCCXIV"       |
* | `4` |  Ones           |  "IV" from "MCCXIV"      |
*
* @example
*
* ```ts
* romanNumeralRegex.exec("M")      // [      "M", "M",   "",  "",   "" ]
* romanNumeralRegex.exec("XII")    // [    "XII",  "",   "", "X", "II" ]
* romanNumeralRegex.exec("MCCXIV") // [ "MCCXIV", "M", "CC", "X", "IV" ]
* ```
*/
export declare const romanNumeralRegex: RegExp;
/**
* Default options for {@link numericQuantity}.
*/
export declare const defaultOptions: Required<NumericQuantityOptions>;
export {};
