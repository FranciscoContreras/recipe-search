import type { NumericQuantityOptions } from "./types.mjs";
/**
* Converts a string to a number, like an enhanced version of `parseFloat`.
*
* The string can include mixed numbers, vulgar fractions, or Roman numerals.
*/
declare function numericQuantity(quantity: string | number): number;
declare function numericQuantity(quantity: string | number): number;
declare function numericQuantity(quantity: string | number, options: NumericQuantityOptions & {
	bigIntOnOverflow: true
}): number | bigint;
declare function numericQuantity(quantity: string | number, options?: NumericQuantityOptions): number;
export { numericQuantity };
