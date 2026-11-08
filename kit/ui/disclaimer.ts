/**
 * kit/ui/disclaimer.ts
 *
 * Shared disclaimer text constant used by every screen that shows a vitals
 * number (AC-5.5, AC-10.6).  Kept in one place so the wording is consistent
 * across apps and exports.
 */

/**
 * Plain-text disclaimer that must appear on every screen displaying a pulse
 * or breathing reading.
 *
 * AC-5.5: "Every screen that shows a number says 'not medical'."
 * AC-10.6: The HTML export and report view must include this text.
 */
export const DISCLAIMER_TEXT =
  'Not a medical device. For wellness and entertainment only.';
